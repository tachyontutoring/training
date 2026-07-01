// Server-side logic for the tutor platform: profiles/roles, rosters, and
// criteria-based practice-set assignments. Uses the Admin SDK.
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getProfile, type AuthedUser } from "@/lib/server-auth";
import { sampleByCriteria, getQuestionById } from "@/lib/question-bank";
import {
  emptyProgress,
  type Assignment,
  type AssignmentCriteria,
  type ProgressStats,
  type UserProfile,
} from "@/lib/types";

// The student's real name lives in Firebase Auth (set at sign-up). The token's
// `name` claim can lag a fresh sign-up, so we read it from the Auth record.
async function authDisplayName(uid: string): Promise<string | null> {
  try {
    const rec = await adminAuth.getUser(uid);
    return rec.displayName?.trim() || null;
  } catch {
    return null;
  }
}

// Create the user's profile doc on first login if it doesn't exist yet, and
// heal a stale name (e.g. an email prefix saved before the name reached us).
// Never downgrades an existing role (e.g. a tutor staying a tutor).
export async function ensureProfile(user: AuthedUser): Promise<UserProfile> {
  const authName = await authDisplayName(user.uid);
  const existing = await getProfile(user.uid);
  if (existing) {
    if (authName && authName !== existing.displayName) {
      await adminDb.doc(`users/${user.uid}`).set({ displayName: authName }, { merge: true });
      return { ...existing, displayName: authName };
    }
    return existing;
  }

  const profile: UserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: authName || user.name || user.email.split("@")[0],
    role: "student",
    tutorId: null,
    createdAt: Date.now(),
  };
  await adminDb.doc(`users/${user.uid}`).set(
    {
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      tutorId: null,
      createdAt: profile.createdAt,
    },
    { merge: true },
  );
  return profile;
}

export async function registerTutor(
  user: AuthedUser,
  accessCode: string,
): Promise<UserProfile> {
  const expected = process.env.TUTOR_ACCESS_CODE;
  if (!expected) {
    throw new Error("Tutor signups are not configured (missing TUTOR_ACCESS_CODE).");
  }
  if (accessCode !== expected) {
    throw new Error("Invalid tutor access code.");
  }
  await adminDb.doc(`users/${user.uid}`).set(
    {
      email: user.email,
      displayName: user.name || user.email.split("@")[0],
      role: "tutor",
      createdAt: Date.now(),
    },
    { merge: true },
  );
  return (await getProfile(user.uid))!;
}

export interface RosterEntry {
  uid: string;
  email: string;
  displayName: string;
  progress: ProgressStats;
  assignmentsTotal: number;
  assignmentsCompleted: number;
}

export async function listStudents(tutorId: string): Promise<RosterEntry[]> {
  const [studentsSnap, assignmentsSnap] = await Promise.all([
    adminDb.collection("users").where("tutorId", "==", tutorId).get(),
    adminDb.collection("assignments").where("tutorId", "==", tutorId).get(),
  ]);

  const counts = new Map<string, { total: number; completed: number }>();
  assignmentsSnap.forEach((d) => {
    const a = d.data() as Assignment;
    const c = counts.get(a.studentId) ?? { total: 0, completed: 0 };
    c.total += 1;
    if (a.status === "completed") c.completed += 1;
    counts.set(a.studentId, c);
  });

  // Real names come from Firebase Auth (source of truth); the profile doc's
  // displayName can be a stale email prefix from before the name reached us.
  const authNames = new Map<string, string>();
  const uids = studentsSnap.docs.map((d) => d.id);
  if (uids.length) {
    try {
      const res = await adminAuth.getUsers(uids.map((uid) => ({ uid })));
      for (const u of res.users) if (u.displayName?.trim()) authNames.set(u.uid, u.displayName.trim());
    } catch {
      /* fall back to stored names */
    }
  }

  return studentsSnap.docs.map((d) => {
    const data = d.data();
    const c = counts.get(d.id) ?? { total: 0, completed: 0 };
    return {
      uid: d.id,
      email: data.email ?? "",
      displayName: authNames.get(d.id) || data.displayName || data.email || "Student",
      progress: (data.progress as ProgressStats) ?? emptyProgress(),
      assignmentsTotal: c.total,
      assignmentsCompleted: c.completed,
    };
  });
}

export async function addStudentByEmail(
  tutorId: string,
  email: string,
  name?: string,
): Promise<RosterEntry> {
  let record;
  try {
    record = await adminAuth.getUserByEmail(email.trim().toLowerCase());
  } catch {
    throw new Error("No account found with that email. Ask them to sign up first.");
  }

  const existing = await getProfile(record.uid);
  if (existing?.role === "tutor") {
    throw new Error("That account belongs to a tutor.");
  }

  // A tutor-supplied name wins, then any existing/Auth name, then the email prefix.
  const tutorName = name?.trim();
  const displayName =
    tutorName ||
    existing?.displayName ||
    record.displayName ||
    (record.email ?? email).split("@")[0];

  await adminDb.doc(`users/${record.uid}`).set(
    {
      email: record.email ?? email,
      displayName,
      role: "student",
      tutorId,
      createdAt: existing?.createdAt ?? Date.now(),
    },
    { merge: true },
  );

  const snap = await adminDb.doc(`users/${record.uid}`).get();
  const data = snap.data()!;
  return {
    uid: record.uid,
    email: data.email,
    displayName: data.displayName,
    progress: (data.progress as ProgressStats) ?? emptyProgress(),
    assignmentsTotal: 0,
    assignmentsCompleted: 0,
  };
}

async function assertOwnsStudent(tutorId: string, studentId: string) {
  const profile = await getProfile(studentId);
  if (!profile || profile.tutorId !== tutorId) {
    throw new Error("That student is not on your roster.");
  }
  return profile;
}

export async function getStudentDetail(tutorId: string, studentId: string) {
  const profile = await assertOwnsStudent(tutorId, studentId);
  const [userSnap, assignmentsSnap] = await Promise.all([
    adminDb.doc(`users/${studentId}`).get(),
    adminDb
      .collection("assignments")
      .where("studentId", "==", studentId)
      .where("tutorId", "==", tutorId)
      .get(),
  ]);
  const progress =
    (userSnap.data()?.progress as ProgressStats) ?? emptyProgress();
  const assignments = assignmentsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Assignment, "id">) }))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Resolve the real name from Auth and heal the stored profile if it was stale.
  const authName = await authDisplayName(studentId);
  if (authName && authName !== profile.displayName) {
    await adminDb.doc(`users/${studentId}`).set({ displayName: authName }, { merge: true });
    profile.displayName = authName;
  }

  return { profile, progress, assignments };
}

// Let a tutor set/correct a student's display name (they own the roster entry).
export async function setStudentName(
  tutorId: string,
  studentId: string,
  name: string,
): Promise<void> {
  await assertOwnsStudent(tutorId, studentId);
  const clean = name.trim();
  if (!clean) throw new Error("Name can't be empty.");
  await adminDb.doc(`users/${studentId}`).set({ displayName: clean }, { merge: true });
}

// Per-student set of question ids the student has already been assigned/seen, so
// no question is ever served to the same student twice.
const seenDocRef = (studentId: string) =>
  adminDb.doc(`users/${studentId}/meta/seenQuestions`);

export async function getUsedQuestionIds(studentId: string): Promise<string[]> {
  const snap = await seenDocRef(studentId).get();
  return (snap.data()?.ids as string[]) ?? [];
}

async function markQuestionsUsed(studentId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await seenDocRef(studentId).set(
    { ids: FieldValue.arrayUnion(...ids) },
    { merge: true },
  );
}

export async function createAssignment(
  tutorId: string,
  studentId: string,
  title: string,
  criteria: AssignmentCriteria,
  explicitQuestionIds?: string[],
): Promise<Assignment> {
  await assertOwnsStudent(tutorId, studentId);

  const used = new Set(await getUsedQuestionIds(studentId));

  let questionIds: string[];
  if (explicitQuestionIds && explicitQuestionIds.length > 0) {
    // Hand-picked questions: keep ones that exist and the student hasn't seen.
    const seen = new Set<string>();
    questionIds = [];
    for (const id of explicitQuestionIds) {
      if (seen.has(id) || used.has(id)) continue;
      if (await getQuestionById(id)) {
        seen.add(id);
        questionIds.push(id);
      }
    }
    if (questionIds.length === 0) {
      throw new Error(
        "None of those questions are available (the student may have already seen them).",
      );
    }
  } else {
    questionIds = await sampleByCriteria({ ...criteria, exclude: [...used] });
    if (questionIds.length === 0) {
      throw new Error(
        "No new questions match those criteria — the student may have seen them all.",
      );
    }
  }

  const ref = adminDb.collection("assignments").doc();
  const assignment: Assignment = {
    id: ref.id,
    tutorId,
    studentId,
    title: title.trim() || "Practice set",
    criteria,
    questionIds,
    createdAt: Date.now(),
    status: "assigned",
    answered: 0,
    correct: 0,
    totalTimeMs: 0,
    completedAt: null,
    sessionId: null,
  };
  await ref.set(assignment);
  // Burn these questions for this student so they never reappear.
  await markQuestionsUsed(studentId, questionIds);
  return assignment;
}

// Assignments a student can see on their own dashboard.
export async function listAssignmentsForStudent(
  studentId: string,
): Promise<Assignment[]> {
  const snap = await adminDb
    .collection("assignments")
    .where("studentId", "==", studentId)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Assignment, "id">) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

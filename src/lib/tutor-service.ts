// Server-side logic for the tutor platform: profiles/roles, rosters, and
// criteria-based practice-set assignments. Uses the Admin SDK.
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getProfile, type AuthedUser } from "@/lib/server-auth";
import { sampleByCriteria } from "@/lib/question-bank";
import {
  emptyProgress,
  type Assignment,
  type AssignmentCriteria,
  type ProgressStats,
  type UserProfile,
} from "@/lib/types";

// Create the user's profile doc on first login if it doesn't exist yet.
// Never downgrades an existing role (e.g. a tutor staying a tutor).
export async function ensureProfile(user: AuthedUser): Promise<UserProfile> {
  const existing = await getProfile(user.uid);
  if (existing) return existing;

  const profile: UserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: user.name || user.email.split("@")[0],
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

  return studentsSnap.docs.map((d) => {
    const data = d.data();
    const c = counts.get(d.id) ?? { total: 0, completed: 0 };
    return {
      uid: d.id,
      email: data.email ?? "",
      displayName: data.displayName ?? data.email ?? "Student",
      progress: (data.progress as ProgressStats) ?? emptyProgress(),
      assignmentsTotal: c.total,
      assignmentsCompleted: c.completed,
    };
  });
}

export async function addStudentByEmail(
  tutorId: string,
  email: string,
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

  await adminDb.doc(`users/${record.uid}`).set(
    {
      email: record.email ?? email,
      displayName:
        existing?.displayName || record.displayName || (record.email ?? email).split("@")[0],
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
  return { profile, progress, assignments };
}

export async function createAssignment(
  tutorId: string,
  studentId: string,
  title: string,
  criteria: AssignmentCriteria,
): Promise<Assignment> {
  await assertOwnsStudent(tutorId, studentId);

  const questionIds = await sampleByCriteria(criteria);
  if (questionIds.length === 0) {
    throw new Error("No questions match those criteria.");
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

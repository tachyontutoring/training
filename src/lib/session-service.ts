// Server-side game engine: create sessions, grade answers, update progress,
// and ask the adaptive picker for the next question. Uses the Admin SDK.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { pickNextQuestion, type Candidate } from "@/lib/claude";
import { getQuestionById, sampleCandidates } from "@/lib/question-bank";
import { gradeAnswer, isValidDraftAnswer } from "@/lib/grid-in";
import {
  emptyProgress,
  toPublicQuestion,
  type Assignment,
  type ProgressStats,
  type PublicQuestion,
  type Question,
  type ResponseDoc,
  type Section,
  type SessionDoc,
  type TestType,
} from "@/lib/types";

const TARGETS: Record<TestType, number> = { full: 20, reading: 10, math: 10 };

// How many unanswered questions to offer the adaptive picker each turn.
const CANDIDATE_LIMIT = 14;

function sectionsFor(type: TestType): Section[] {
  if (type === "reading") return ["reading"];
  if (type === "math") return ["math"];
  return ["reading", "math"];
}

// Candidate pools come from the in-memory question-bank cache (loadCandidatePool
// → sampleCandidates), so no Firestore read happens on the hot path.
function toCandidates(qs: Question[]): Candidate[] {
  return qs.map((q) => ({
    id: q.id,
    section: q.section,
    skill: q.skill,
    difficulty: q.difficulty,
  }));
}

async function getProgress(uid: string): Promise<ProgressStats> {
  const doc = await adminDb.doc(`users/${uid}`).get();
  const data = doc.data();
  return (data?.progress as ProgressStats) ?? emptyProgress();
}

export interface AdvanceResult {
  session: SessionDoc;
  question: PublicQuestion | null;
  coaching: string;
}

export async function createSession(
  uid: string,
  type: TestType,
): Promise<AdvanceResult> {
  const sections = sectionsFor(type);
  const pool = await sampleCandidates(sections, [], CANDIDATE_LIMIT);
  if (pool.length === 0) {
    throw new Error("No questions in the bank for this section. Run `pnpm seed`.");
  }

  const progress = await getProgress(uid);
  const pick = await pickNextQuestion({
    candidates: toCandidates(pool),
    recent: [],
    progress,
    lastCorrect: null,
  });

  const ref = adminDb.collection(`users/${uid}/sessions`).doc();
  const session: SessionDoc = {
    id: ref.id,
    type,
    createdAt: Date.now(),
    status: "active",
    targetCount: TARGETS[type],
    answered: 0,
    correct: 0,
    totalTimeMs: 0,
    servedQuestionIds: [pick.questionId],
    currentQuestionId: pick.questionId,
  };
  await ref.set(session);

  const question = pool.find((q) => q.id === pick.questionId)!;
  return { session, question: toPublicQuestion(question), coaching: pick.coaching };
}

// Start a session backed by a tutor-assigned practice set. Questions are served
// from the assignment's fixed list in order (no adaptive selection).
export async function createAssignmentSession(
  uid: string,
  assignmentId: string,
): Promise<AdvanceResult> {
  const aRef = adminDb.doc(`assignments/${assignmentId}`);
  const aSnap = await aRef.get();
  if (!aSnap.exists) throw new Error("Assignment not found");
  const assignment = { id: aSnap.id, ...(aSnap.data() as Omit<Assignment, "id">) };
  if (assignment.studentId !== uid) {
    throw new Error("This assignment isn't yours.");
  }

  // Resume an already-started session for this assignment instead of wiping
  // progress and starting over. We pick up at its current question.
  if (assignment.sessionId) {
    const existingRef = adminDb.doc(`users/${uid}/sessions/${assignment.sessionId}`);
    const existingSnap = await existingRef.get();
    if (existingSnap.exists) {
      const existing = existingSnap.data() as SessionDoc;
      if (existing.status === "active" && existing.currentQuestionId) {
        const current = await getQuestionById(existing.currentQuestionId);
        if (current) {
          return {
            session: existing,
            question: toPublicQuestion(current),
            coaching:
              existing.answered > 0
                ? `Resuming: ${assignment.title} (${existing.answered} of ${existing.targetCount} done)`
                : `Assigned by your tutor: ${assignment.title}`,
          };
        }
      }
    }
  }

  // Keep only ids that still exist in the bank.
  const queue: string[] = [];
  for (const id of assignment.questionIds) {
    if (await getQuestionById(id)) queue.push(id);
  }
  if (queue.length === 0) throw new Error("This assignment has no available questions.");

  const ref = adminDb.collection(`users/${uid}/sessions`).doc();
  const session: SessionDoc = {
    id: ref.id,
    type: "reading",
    createdAt: Date.now(),
    status: "active",
    targetCount: queue.length,
    answered: 0,
    correct: 0,
    totalTimeMs: 0,
    servedQuestionIds: [queue[0]],
    currentQuestionId: queue[0],
    assignmentId: assignment.id,
    queue,
  };
  await ref.set(session);
  await aRef.set({ sessionId: ref.id }, { merge: true });

  const first = (await getQuestionById(queue[0]))!;
  return {
    session,
    question: toPublicQuestion(first),
    coaching: `Assigned by your tutor: ${assignment.title}`,
  };
}

export async function getSession(
  uid: string,
  sessionId: string,
): Promise<AdvanceResult | null> {
  const ref = adminDb.doc(`users/${uid}/sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const session = snap.data() as SessionDoc;

  let question: PublicQuestion | null = null;
  if (session.currentQuestionId) {
    const q = await getQuestionById(session.currentQuestionId);
    if (q) question = toPublicQuestion(q);
  }
  return { session, question, coaching: "" };
}

// The ordered ids a session covers — the assignment queue, or whatever has been
// served for an adaptive session.
function coveredIds(session: SessionDoc): string[] {
  return (session.queue && session.queue.length
    ? session.queue
    : session.servedQuestionIds) ?? [];
}

export interface SessionFull {
  session: SessionDoc;
  questions: PublicQuestion[];
  answers: Record<string, string>;
  marked: string[];
  currentIndex: number;
}

// Full session state for the Bluebook-style runner: every question (no answers)
// plus the saved answer drafts, marks, and last position.
export async function getSessionFull(
  uid: string,
  sessionId: string,
): Promise<SessionFull | null> {
  const ref = adminDb.doc(`users/${uid}/sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const session = snap.data() as SessionDoc;

  const questions: PublicQuestion[] = [];
  for (const id of coveredIds(session)) {
    const q = await getQuestionById(id);
    if (q) questions.push(toPublicQuestion(q));
  }
  return {
    session,
    questions,
    answers: session.draftAnswers ?? {},
    marked: session.markedQuestionIds ?? [],
    currentIndex: session.currentIndex ?? 0,
  };
}

// Persist ungraded progress so a set can be resumed. Never grades.
export async function saveDraft(
  uid: string,
  sessionId: string,
  draft: { answers?: Record<string, string>; marked?: string[]; currentIndex?: number },
): Promise<void> {
  const ref = adminDb.doc(`users/${uid}/sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Session not found");
  const session = snap.data() as SessionDoc;
  if (session.status === "completed") return; // already graded — ignore late saves

  const valid = new Set(coveredIds(session));
  const answers: Record<string, string> = {};
  for (const [qid, a] of Object.entries(draft.answers ?? {})) {
    if (!valid.has(qid)) continue;
    const q = await getQuestionById(qid);
    if (q && isValidDraftAnswer(q.type, a)) answers[qid] = a;
  }
  const marked = (draft.marked ?? []).filter((id) => valid.has(id));
  const currentIndex = Number.isFinite(draft.currentIndex) ? Number(draft.currentIndex) : 0;

  const writes: Promise<unknown>[] = [
    ref.set({ draftAnswers: answers, markedQuestionIds: marked, currentIndex }, { merge: true }),
  ];
  // Reflect in-progress count on the assignment (dashboard "Resume 3/10").
  if (session.assignmentId) {
    writes.push(
      adminDb
        .doc(`assignments/${session.assignmentId}`)
        .set({ status: "assigned", answered: Object.keys(answers).length }, { merge: true }),
    );
  }
  await Promise.all(writes);
}

export interface SubmittedQuestion {
  questionId: string;
  yourAnswer: string | null;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
}
export interface SubmitResult {
  session: SessionDoc;
  results: SubmittedQuestion[];
}

// Grade an entire set at once (end of a Bluebook-style run). Idempotent: if the
// session is already completed, it re-reports results without touching progress.
export async function submitSession(
  uid: string,
  sessionId: string,
  answers: Record<string, string>,
  times: Record<string, number> = {},
): Promise<SubmitResult> {
  const ref = adminDb.doc(`users/${uid}/sessions/${sessionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Session not found");
  const session = snap.data() as SessionDoc;

  const alreadyDone = session.status === "completed";
  const source = alreadyDone ? session.draftAnswers ?? {} : answers;

  const progress = await getProgress(uid);
  progress.bySkill ??= {};
  progress.bySubSkill ??= {};
  const results: SubmittedQuestion[] = [];
  const responseWrites: Promise<unknown>[] = [];
  let answered = 0;
  let correctCount = 0;
  let totalTimeMs = 0;

  for (const id of coveredIds(session)) {
    const q = await getQuestionById(id);
    if (!q) continue;
    const { your, correct: isCorrect } = gradeAnswer(q, source[id]);
    results.push({
      questionId: id,
      yourAnswer: your,
      correctAnswer: q.correctAnswer,
      correct: isCorrect,
      explanation: q.explanation,
    });
    if (alreadyDone || your == null) continue;

    answered += 1;
    if (isCorrect) correctCount += 1;
    const t = Math.max(0, Math.floor(times[id] ?? 0));
    totalTimeMs += t;

    progress.totalAnswered += 1;
    if (isCorrect) progress.totalCorrect += 1;
    progress.bySection[q.section].answered += 1;
    if (isCorrect) progress.bySection[q.section].correct += 1;
    const sk = (progress.bySkill[q.skill] ??= { answered: 0, correct: 0 });
    sk.answered += 1;
    if (isCorrect) sk.correct += 1;
    if (q.subSkill) {
      const ss = (progress.bySubSkill[q.subSkill] ??= { answered: 0, correct: 0 });
      ss.answered += 1;
      if (isCorrect) ss.correct += 1;
    }

    const response: ResponseDoc = {
      questionId: id,
      section: q.section,
      skill: q.skill,
      subSkill: q.subSkill ?? null,
      difficulty: q.difficulty,
      selectedAnswer: your,
      correct: isCorrect,
      answeredAt: Date.now(),
      timeMs: t,
    };
    responseWrites.push(
      adminDb.doc(`users/${uid}/sessions/${sessionId}/responses/${id}`).set(response),
    );
  }

  if (alreadyDone) return { session, results };

  progress.updatedAt = Date.now();
  const updatedSession: SessionDoc = {
    ...session,
    answered,
    correct: correctCount,
    totalTimeMs,
    status: "completed",
    currentQuestionId: null,
    draftAnswers: source,
  };
  const writes: Promise<unknown>[] = [
    ...responseWrites,
    adminDb
      .doc(`users/${uid}`)
      .set({ progress, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ref.set(updatedSession),
  ];
  if (session.assignmentId) {
    writes.push(
      adminDb.doc(`assignments/${session.assignmentId}`).set(
        {
          status: "completed",
          answered,
          correct: correctCount,
          totalTimeMs,
          completedAt: Date.now(),
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes);
  return { session: updatedSession, results };
}

export interface GradeResult {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
  coaching: string;
  session: SessionDoc;
  next: PublicQuestion | null;
  finished: boolean;
}

export async function submitAnswer(
  uid: string,
  sessionId: string,
  questionId: string,
  selectedAnswer: string,
  timeMs: number,
): Promise<GradeResult> {
  const sessionRef = adminDb.doc(`users/${uid}/sessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) throw new Error("Session not found");
  const session = sessionSnap.data() as SessionDoc;

  // Guard against replaying / answering a stale question.
  if (session.currentQuestionId !== questionId) {
    throw new Error("This question is not the active one for the session.");
  }

  const question = await getQuestionById(questionId);
  if (!question) throw new Error("Question not found");

  const { your, correct } = gradeAnswer(question, selectedAnswer);

  const response: ResponseDoc = {
    questionId,
    section: question.section,
    skill: question.skill,
    subSkill: question.subSkill ?? null,
    difficulty: question.difficulty,
    selectedAnswer: your ?? selectedAnswer,
    correct,
    answeredAt: Date.now(),
    timeMs,
  };

  // Update aggregate progress on the user doc.
  const progress = await getProgress(uid);
  progress.bySkill ??= {};
  progress.bySubSkill ??= {};
  progress.totalAnswered += 1;
  if (correct) progress.totalCorrect += 1;
  progress.bySection[question.section].answered += 1;
  if (correct) progress.bySection[question.section].correct += 1;
  const skill = (progress.bySkill[question.skill] ??= { answered: 0, correct: 0 });
  skill.answered += 1;
  if (correct) skill.correct += 1;
  if (question.subSkill) {
    const ss = (progress.bySubSkill[question.subSkill] ??= { answered: 0, correct: 0 });
    ss.answered += 1;
    if (correct) ss.correct += 1;
  }
  progress.updatedAt = Date.now();

  // Fire the response + progress writes concurrently — neither blocks picking
  // the next question. We await them together with the session write at the end.
  const writes: Promise<unknown>[] = [
    adminDb
      .doc(`users/${uid}/sessions/${sessionId}/responses/${questionId}`)
      .set(response),
    adminDb
      .doc(`users/${uid}`)
      .set({ progress, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
  ];

  const answered = session.answered + 1;
  const correctCount = session.correct + (correct ? 1 : 0);
  const finished = answered >= session.targetCount;

  // Choose the next question. Assignment sessions walk a fixed queue in order;
  // everything else uses the adaptive picker.
  let next: PublicQuestion | null = null;
  let coaching = "";
  let nextId: string | null = null;

  const isAssignment = Array.isArray(session.queue) && session.queue.length > 0;

  if (!finished && isAssignment) {
    const nextIndex = session.servedQuestionIds.length;
    const candidateId = session.queue![nextIndex] ?? null;
    const nextQuestion = candidateId ? await getQuestionById(candidateId) : null;
    if (nextQuestion) {
      nextId = candidateId;
      next = toPublicQuestion(nextQuestion);
    }
  } else if (!finished) {
    const pool = await sampleCandidates(
      sectionsFor(session.type),
      session.servedQuestionIds,
      CANDIDATE_LIMIT,
    );
    if (pool.length > 0) {
      // The recent-answer history is only consumed by the Claude picker; skip
      // the Firestore read entirely when running on the heuristic.
      const recent: ResponseDoc[] = process.env.ANTHROPIC_API_KEY
        ? (
            await adminDb
              .collection(`users/${uid}/sessions/${sessionId}/responses`)
              .orderBy("answeredAt", "asc")
              .get()
          ).docs.map((d) => d.data() as ResponseDoc)
        : [];

      const pick = await pickNextQuestion({
        candidates: toCandidates(pool),
        recent,
        progress,
        lastCorrect: correct,
      });
      nextId = pick.questionId;
      coaching = pick.coaching;
      next = toPublicQuestion(pool.find((q) => q.id === nextId)!);
    }
  }

  const updatedSession: SessionDoc = {
    ...session,
    answered,
    correct: correctCount,
    totalTimeMs: (session.totalTimeMs ?? 0) + timeMs,
    status: finished || !nextId ? "completed" : "active",
    currentQuestionId: nextId,
    servedQuestionIds: nextId
      ? [...session.servedQuestionIds, nextId]
      : session.servedQuestionIds,
  };
  writes.push(sessionRef.set(updatedSession));

  // Mirror live progress onto the assignment doc each answer, so the student's
  // dashboard can show "Resume (3/10)" and the tutor can see in-progress sets.
  if (session.assignmentId) {
    const done = updatedSession.status === "completed";
    writes.push(
      adminDb.doc(`assignments/${session.assignmentId}`).set(
        {
          status: done ? "completed" : "assigned",
          answered: updatedSession.answered,
          correct: updatedSession.correct,
          totalTimeMs: updatedSession.totalTimeMs,
          ...(done ? { completedAt: Date.now() } : {}),
        },
        { merge: true },
      ),
    );
  }

  await Promise.all(writes);

  return {
    correct,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
    coaching,
    session: updatedSession,
    next,
    finished: updatedSession.status === "completed",
  };
}

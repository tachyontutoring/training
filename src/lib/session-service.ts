// Server-side game engine: create sessions, grade answers, update progress,
// and ask the adaptive picker for the next question. Uses the Admin SDK.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { pickNextQuestion, type Candidate } from "@/lib/claude";
import { getQuestionById, sampleCandidates } from "@/lib/question-bank";
import {
  emptyProgress,
  toPublicQuestion,
  type AnswerKey,
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

export interface GradeResult {
  correct: boolean;
  correctAnswer: AnswerKey;
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
  selectedAnswer: AnswerKey,
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

  const correct = selectedAnswer === question.correctAnswer;

  const response: ResponseDoc = {
    questionId,
    section: question.section,
    skill: question.skill,
    difficulty: question.difficulty,
    selectedAnswer,
    correct,
    answeredAt: Date.now(),
    timeMs,
  };

  // Update aggregate progress on the user doc.
  const progress = await getProgress(uid);
  progress.totalAnswered += 1;
  if (correct) progress.totalCorrect += 1;
  progress.bySection[question.section].answered += 1;
  if (correct) progress.bySection[question.section].correct += 1;
  const skill = (progress.bySkill[question.skill] ??= { answered: 0, correct: 0 });
  skill.answered += 1;
  if (correct) skill.correct += 1;
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

  // When a tutor-assigned set is finished, record results on the assignment.
  if (updatedSession.status === "completed" && session.assignmentId) {
    writes.push(
      adminDb.doc(`assignments/${session.assignmentId}`).set(
        {
          status: "completed",
          answered: updatedSession.answered,
          correct: updatedSession.correct,
          totalTimeMs: updatedSession.totalTimeMs,
          completedAt: Date.now(),
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

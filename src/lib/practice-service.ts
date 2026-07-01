// Server-side engine for full, timed, adaptive practice tests. A test is a
// sequence of modules; Module 1 of each section is fixed, Module 2 is assembled
// (easy/hard) from the student's Module 1 score. Uses the Admin SDK + bank.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import {
  getQuestionById,
  sampleModuleQuestions,
} from "@/lib/question-bank";
import {
  emptyProgress,
  toPublicQuestion,
  type AnswerKey,
  type ProgressStats,
  type PublicQuestion,
} from "@/lib/types";
import {
  getBlueprint,
  type PracticeModule,
  type PracticeTestSession,
  type PTModuleState,
  type SelectionRule,
} from "@/lib/practice-tests";

const ANSWER_KEYS = new Set<AnswerKey>(["A", "B", "C", "D"]);

function ref(uid: string, id: string) {
  return adminDb.doc(`users/${uid}/practiceTests/${id}`);
}

async function getProgress(uid: string): Promise<ProgressStats> {
  const doc = await adminDb.doc(`users/${uid}`).get();
  const p = (doc.data()?.progress as ProgressStats) ?? emptyProgress();
  p.bySkill ??= {};
  p.bySubSkill ??= {};
  return p;
}

async function ruleFor(
  mod: PracticeModule,
  modules: PTModuleState[],
): Promise<{ rule: SelectionRule; tier: "easy" | "hard" | null }> {
  if (mod.rule) return { rule: mod.rule, tier: null };
  if (mod.tiers && mod.adaptiveFrom) {
    const from = modules.find((m) => m.id === mod.adaptiveFrom);
    const frac = from && from.answered ? from.correct / from.answered : 0;
    const tier = frac >= (mod.hardTierThreshold ?? 0.6) ? "hard" : "easy";
    return { rule: mod.tiers[tier], tier };
  }
  // Shouldn't happen for a well-formed blueprint.
  return { rule: { sections: [mod.section], skillDifficultyMix: {} }, tier: null };
}

async function assembleModule(
  mod: PracticeModule,
  state: PTModuleState,
  modules: PTModuleState[],
): Promise<void> {
  const exclude = modules.flatMap((m) => m.questionIds ?? []);
  const { rule, tier } = await ruleFor(mod, modules);
  const ids = await sampleModuleQuestions({
    sections: rule.sections,
    mix: rule.skillDifficultyMix,
    exclude,
  });
  state.questionIds = ids;
  state.tier = tier;
  state.status = "active";
}

export async function createPracticeTest(
  uid: string,
  blueprintId: string,
): Promise<string> {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error("Unknown practice test.");

  const docRef = ref(uid, adminDb.collection(`users/${uid}/practiceTests`).doc().id);
  const modules: PTModuleState[] = bp.modules.map((m) => ({
    id: m.id,
    title: m.title,
    section: m.section,
    timeMs: m.timeMs,
    tier: null,
    questionIds: null,
    answers: {},
    status: "pending",
    answered: 0,
    correct: 0,
    timeSpentMs: 0,
  }));
  // Assemble the first module now.
  await assembleModule(bp.modules[0], modules[0], modules);

  const session: PracticeTestSession = {
    id: docRef.id,
    blueprintId: bp.id,
    title: bp.title,
    createdAt: Date.now(),
    status: "active",
    currentModuleIndex: 0,
    modules,
    totalAnswered: 0,
    totalCorrect: 0,
    completedAt: null,
  };
  await docRef.set(session);
  return docRef.id;
}

// ---- client-facing view -----------------------------------------------------
export interface PTModuleMeta {
  id: string;
  title: string;
  section: string;
  timeMs: number;
  status: string;
  tier: "easy" | "hard" | null;
  answered: number;
  correct: number;
  total: number;
}
export interface PTCurrent {
  index: number;
  id: string;
  title: string;
  section: string;
  timeMs: number;
  tier: "easy" | "hard" | null;
  questions: PublicQuestion[];
  answers: Record<string, AnswerKey>;
}
export interface PTReviewItem extends PublicQuestion {
  yourAnswer: AnswerKey | null;
  correctAnswer: AnswerKey;
  isCorrect: boolean;
  explanation: string;
}
export interface PTReviewModule {
  id: string;
  title: string;
  section: string;
  answered: number;
  correct: number;
  total: number;
  items: PTReviewItem[];
}
export interface PTView {
  id: string;
  title: string;
  status: "active" | "completed";
  currentModuleIndex: number;
  totalAnswered: number;
  totalCorrect: number;
  modules: PTModuleMeta[];
  current: PTCurrent | null;
  results: PTReviewModule[] | null;
}

async function publicQuestions(ids: string[]): Promise<PublicQuestion[]> {
  const out: PublicQuestion[] = [];
  for (const id of ids) {
    const q = await getQuestionById(id);
    if (q) out.push(toPublicQuestion(q));
  }
  return out;
}

async function buildView(session: PracticeTestSession): Promise<PTView> {
  const modules: PTModuleMeta[] = session.modules.map((m) => ({
    id: m.id,
    title: m.title,
    section: m.section,
    timeMs: m.timeMs,
    status: m.status,
    tier: m.tier,
    answered: m.answered,
    correct: m.correct,
    total: m.questionIds?.length ?? 0,
  }));

  let current: PTCurrent | null = null;
  if (session.status === "active") {
    const cur = session.modules[session.currentModuleIndex];
    current = {
      index: session.currentModuleIndex,
      id: cur.id,
      title: cur.title,
      section: cur.section,
      timeMs: cur.timeMs,
      tier: cur.tier,
      questions: await publicQuestions(cur.questionIds ?? []),
      answers: cur.answers ?? {},
    };
  }

  let results: PTReviewModule[] | null = null;
  if (session.status === "completed") {
    results = [];
    for (const m of session.modules) {
      const items: PTReviewItem[] = [];
      for (const id of m.questionIds ?? []) {
        const q = await getQuestionById(id);
        if (!q) continue;
        const your = m.answers?.[id] ?? null;
        items.push({
          ...toPublicQuestion(q),
          yourAnswer: your,
          correctAnswer: q.correctAnswer,
          isCorrect: your != null && your === q.correctAnswer,
          explanation: q.explanation,
        });
      }
      results.push({
        id: m.id,
        title: m.title,
        section: m.section,
        answered: m.answered,
        correct: m.correct,
        total: m.questionIds?.length ?? 0,
        items,
      });
    }
  }

  return {
    id: session.id,
    title: session.title,
    status: session.status,
    currentModuleIndex: session.currentModuleIndex,
    totalAnswered: session.totalAnswered,
    totalCorrect: session.totalCorrect,
    modules,
    current,
    results,
  };
}

// Compact summary of a student's practice test(s), for the tutor's view.
export interface PTSectionScore {
  answered: number;
  correct: number;
  pct: number;
}
export interface PracticeTestSummary {
  id: string;
  title: string;
  status: "active" | "completed";
  createdAt: number;
  completedAt: number | null;
  totalAnswered: number;
  totalCorrect: number;
  pct: number;
  reading: PTSectionScore;
  math: PTSectionScore;
  modules: {
    id: string;
    title: string;
    section: string;
    tier: "easy" | "hard" | null;
    answered: number;
    correct: number;
    total: number;
  }[];
}

export async function listPracticeSummaries(
  studentId: string,
): Promise<PracticeTestSummary[]> {
  const snap = await adminDb.collection(`users/${studentId}/practiceTests`).get();
  const score = (mods: PTModuleState[], sec: string): PTSectionScore => {
    const m = mods.filter((x) => x.section === sec);
    const answered = m.reduce((s, x) => s + x.answered, 0);
    const correct = m.reduce((s, x) => s + x.correct, 0);
    return { answered, correct, pct: answered ? Math.round((correct / answered) * 100) : 0 };
  };
  return snap.docs
    .map((d) => {
      const s = d.data() as PracticeTestSession;
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        completedAt: s.completedAt ?? null,
        totalAnswered: s.totalAnswered,
        totalCorrect: s.totalCorrect,
        pct: s.totalAnswered ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0,
        reading: score(s.modules, "reading"),
        math: score(s.modules, "math"),
        modules: s.modules.map((m) => ({
          id: m.id,
          title: m.title,
          section: m.section,
          tier: m.tier,
          answered: m.answered,
          correct: m.correct,
          total: m.questionIds?.length ?? 0,
        })),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPracticeTest(uid: string, id: string): Promise<PTView | null> {
  const snap = await ref(uid, id).get();
  if (!snap.exists) return null;
  return buildView(snap.data() as PracticeTestSession);
}

export async function savePracticeDraft(
  uid: string,
  id: string,
  answers: Record<string, string>,
): Promise<void> {
  const r = ref(uid, id);
  const snap = await r.get();
  if (!snap.exists) throw new Error("Practice test not found");
  const session = snap.data() as PracticeTestSession;
  if (session.status === "completed") return;
  const cur = session.modules[session.currentModuleIndex];
  const valid = new Set(cur.questionIds ?? []);
  const clean: Record<string, AnswerKey> = {};
  for (const [qid, a] of Object.entries(answers ?? {})) {
    if (valid.has(qid) && ANSWER_KEYS.has(a as AnswerKey)) clean[qid] = a as AnswerKey;
  }
  session.modules[session.currentModuleIndex] = { ...cur, answers: clean };
  await r.set(session);
}

// Grade the current module, update aggregate progress, then assemble & advance
// to the next module (choosing the adaptive tier), or finish the test.
export async function submitModule(
  uid: string,
  id: string,
  answers: Record<string, string>,
  times: Record<string, number> = {},
): Promise<PTView> {
  const r = ref(uid, id);
  const snap = await r.get();
  if (!snap.exists) throw new Error("Practice test not found");
  const session = snap.data() as PracticeTestSession;
  if (session.status === "completed") return buildView(session);

  const bp = getBlueprint(session.blueprintId);
  if (!bp) throw new Error("Unknown practice test.");

  const cur = session.modules[session.currentModuleIndex];
  const progress = await getProgress(uid);

  const graded: Record<string, AnswerKey> = {};
  let answered = 0;
  let correct = 0;
  let timeSpent = 0;
  for (const qid of cur.questionIds ?? []) {
    const raw = answers[qid];
    const your = ANSWER_KEYS.has(raw as AnswerKey) ? (raw as AnswerKey) : null;
    if (your == null) continue;
    graded[qid] = your;
    const q = await getQuestionById(qid);
    if (!q) continue;
    answered += 1;
    const ok = your === q.correctAnswer;
    if (ok) correct += 1;
    timeSpent += Math.max(0, Math.floor(times[qid] ?? 0));
    progress.totalAnswered += 1;
    if (ok) progress.totalCorrect += 1;
    progress.bySection[q.section].answered += 1;
    if (ok) progress.bySection[q.section].correct += 1;
    const sk = (progress.bySkill[q.skill] ??= { answered: 0, correct: 0 });
    sk.answered += 1;
    if (ok) sk.correct += 1;
    if (q.subSkill) {
      const ss = (progress.bySubSkill[q.subSkill] ??= { answered: 0, correct: 0 });
      ss.answered += 1;
      if (ok) ss.correct += 1;
    }
  }
  progress.updatedAt = Date.now();

  session.modules[session.currentModuleIndex] = {
    ...cur,
    answers: graded,
    answered,
    correct,
    timeSpentMs: timeSpent,
    status: "submitted",
  };
  session.totalAnswered += answered;
  session.totalCorrect += correct;

  const nextIndex = session.currentModuleIndex + 1;
  if (nextIndex < session.modules.length) {
    await assembleModule(bp.modules[nextIndex], session.modules[nextIndex], session.modules);
    session.currentModuleIndex = nextIndex;
  } else {
    session.status = "completed";
    session.completedAt = Date.now();
  }

  await Promise.all([
    r.set(session),
    adminDb
      .doc(`users/${uid}`)
      .set({ progress, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
  ]);

  return buildView(session);
}

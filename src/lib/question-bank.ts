// In-memory cache of the question bank. The bank is STATIC reference data, so
// we load it from a local snapshot file (data/question-bank.json, produced by
// `pnpm seed`) — this costs ZERO Firestore reads no matter how many times the
// server restarts or cold-starts. Firestore still stores the bank as the
// source of truth; the app just doesn't pay to re-read it on every boot.
//
// We also stash the cache on globalThis so Next.js dev hot-reloads (which
// re-evaluate modules and would otherwise reset module-level state) reuse it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminDb } from "@/lib/firebase/admin";
import type { Question, Section } from "@/lib/types";

interface BankState {
  cache: Question[] | null;
  byId: Map<string, Question> | null;
  loadingPromise: Promise<void> | null;
  loadedAt: number;
}

const g = globalThis as unknown as { __questionBank?: BankState };
const state: BankState =
  g.__questionBank ??
  (g.__questionBank = {
    cache: null,
    byId: null,
    loadingPromise: null,
    loadedAt: 0,
  });

const SNAPSHOT_PATH = join(process.cwd(), "data", "question-bank.json");

async function load(): Promise<void> {
  let all: Question[];
  let source: string;
  try {
    all = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Question[];
    source = "local snapshot";
  } catch {
    // Fallback for an unseeded checkout: read once from Firestore.
    const snap = await adminDb.collection("questions").get();
    all = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Question, "id">),
    }));
    source = "Firestore (no snapshot found — run `pnpm seed`)";
  }
  state.cache = all;
  state.byId = new Map(all.map((q) => [q.id, q]));
  state.loadedAt = Date.now();
  console.log(`[question-bank] cached ${all.length} questions from ${source}`);
}

// Loads the bank if it isn't cached yet. Concurrent callers share one load.
export async function ensureLoaded(): Promise<void> {
  if (state.cache) return;
  if (!state.loadingPromise) {
    state.loadingPromise = load().finally(() => {
      state.loadingPromise = null;
    });
  }
  await state.loadingPromise;
}

export async function getQuestionById(id: string): Promise<Question | null> {
  await ensureLoaded();
  return state.byId!.get(id) ?? null;
}

export async function bankSize(): Promise<number> {
  await ensureLoaded();
  return state.cache!.length;
}

export function bankStats() {
  return { loaded: !!state.cache, size: state.cache?.length ?? 0, loadedAt: state.loadedAt };
}

// Force a reload (e.g. after re-seeding). Safe to call anytime.
export async function refresh(): Promise<void> {
  state.cache = null;
  state.byId = null;
  await ensureLoaded();
}

// The section → skill → subskill tree plus difficulties, for building the
// tutor's assignment form. Sections come in test order; skills/subskills sorted.
export interface SkillFacet {
  skill: string;
  subSkills: string[];
}
export interface SectionFacet {
  section: Section;
  label: string;
  skills: SkillFacet[];
}

const SECTION_LABEL: Record<Section, string> = {
  reading: "Reading & Writing",
  math: "Math",
};
const SECTION_ORDER: Section[] = ["reading", "math"];

export async function bankFacets(): Promise<{
  sections: SectionFacet[];
  difficulties: number[];
}> {
  await ensureLoaded();
  const difficulties = new Set<number>();
  // section -> (skill -> set of subskills)
  const tree = new Map<Section, Map<string, Set<string>>>();
  for (const q of state.cache!) {
    difficulties.add(q.difficulty);
    if (!tree.has(q.section)) tree.set(q.section, new Map());
    const skillMap = tree.get(q.section)!;
    if (!skillMap.has(q.skill)) skillMap.set(q.skill, new Set());
    if (q.subSkill) skillMap.get(q.skill)!.add(q.subSkill);
  }
  const sections: SectionFacet[] = SECTION_ORDER.filter((s) => tree.has(s)).map(
    (s) => ({
      section: s,
      label: SECTION_LABEL[s],
      skills: [...tree.get(s)!.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([skill, subs]) => ({ skill, subSkills: [...subs].sort() })),
    }),
  );
  return {
    sections,
    difficulties: [...difficulties].sort((a, b) => a - b),
  };
}

// Randomly sample up to `count` questions matching the given criteria. Empty
// sections/skills/subSkills/difficulties each mean "any". A subskill selection
// narrows ONLY its own skill: a question qualifies on the skill axis if its
// subskill is explicitly chosen, OR its skill is chosen and that skill has no
// subskill selected (so "skill A (all) + subskill B1 of skill B" works).
export async function sampleByCriteria(criteria: {
  sections?: Section[];
  skills: string[];
  subSkills?: string[];
  difficulties: number[];
  count: number;
  exclude?: string[];
}): Promise<string[]> {
  await ensureLoaded();
  const sectionSet = new Set(criteria.sections ?? []);
  const skillSet = new Set(criteria.skills ?? []);
  const subSkillSet = new Set(criteria.subSkills ?? []);
  const diffSet = new Set(criteria.difficulties ?? []);
  const excludeSet = new Set(criteria.exclude ?? []);

  // Which skills have a narrowing subskill selected (maps subskill → its skill).
  const skillsWithSelectedSub = new Set<string>();
  if (subSkillSet.size) {
    const subToSkill = new Map<string, string>();
    for (const q of state.cache!) {
      if (q.subSkill && !subToSkill.has(q.subSkill)) subToSkill.set(q.subSkill, q.skill);
    }
    for (const ss of subSkillSet) {
      const sk = subToSkill.get(ss);
      if (sk) skillsWithSelectedSub.add(sk);
    }
  }
  const anySkillFilter = skillSet.size > 0 || subSkillSet.size > 0;

  const pool = state.cache!.filter((q) => {
    if (excludeSet.has(q.id)) return false;
    if (sectionSet.size && !sectionSet.has(q.section)) return false;
    if (diffSet.size && !diffSet.has(q.difficulty)) return false;
    if (!anySkillFilter) return true;
    if (q.subSkill && subSkillSet.has(q.subSkill)) return true;
    if (skillSet.has(q.skill) && !skillsWithSelectedSub.has(q.skill)) return true;
    return false;
  });
  // Partial Fisher–Yates for the first `count` slots.
  const n = Math.min(criteria.count, pool.length);
  const picks = pool.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (picks.length - i));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, n).map((q) => q.id);
}

// A tutor-facing preview of a bank question (includes the answer + explanation,
// which is fine because this only ever goes to authenticated tutors).
export interface QuestionPreview {
  id: string;
  section: Section;
  skill: string;
  subSkill: string | null;
  difficulty: number;
  prompt: string;
  passage: string | null;
  stimulusImage: string | null;
  stimulusTableHtml: string | null;
  choices: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  hasStimulus: boolean;
}

// Browse the bank for the tutor's "pick specific questions" flow. Filters mirror
// sampleByCriteria; `exclude` drops questions the student has already seen.
export async function searchQuestions(filter: {
  sections?: Section[];
  skills?: string[];
  subSkills?: string[];
  difficulties?: number[];
  exclude?: string[];
  limit?: number;
}): Promise<{ questions: QuestionPreview[]; total: number }> {
  await ensureLoaded();
  const sectionSet = new Set(filter.sections ?? []);
  const skillSet = new Set(filter.skills ?? []);
  const subSkillSet = new Set(filter.subSkills ?? []);
  const diffSet = new Set(filter.difficulties ?? []);
  const excludeSet = new Set(filter.exclude ?? []);
  const limit = Math.max(1, Math.min(200, filter.limit ?? 50));

  const matches = state.cache!.filter((q) => {
    if (excludeSet.has(q.id)) return false;
    if (sectionSet.size && !sectionSet.has(q.section)) return false;
    if (diffSet.size && !diffSet.has(q.difficulty)) return false;
    if (skillSet.size && !skillSet.has(q.skill)) return false;
    if (subSkillSet.size && !(q.subSkill && subSkillSet.has(q.subSkill))) return false;
    return true;
  });

  const questions = matches.slice(0, limit).map((q) => ({
    id: q.id,
    section: q.section,
    skill: q.skill,
    subSkill: q.subSkill ?? null,
    difficulty: q.difficulty,
    prompt: q.prompt,
    passage: q.passage ?? null,
    stimulusImage: q.stimulusImage ?? null,
    stimulusTableHtml: q.stimulusTableHtml ?? null,
    choices: q.choices,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    hasStimulus: !!(q.stimulusImage || q.stimulusTableHtml || (q.passage && q.passage.trim())),
  }));
  return { questions, total: matches.length };
}

// Random `n` from a pool via partial Fisher–Yates (no full shuffle).
function pickRandom<T>(pool: T[], n: number): T[] {
  const k = Math.min(n, pool.length);
  const arr = pool.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

// Assemble one practice-test module: for each skill×difficulty cell in the mix,
// pull that many questions. If a cell is short, backfill from the same skill
// (any difficulty). `exclude` avoids repeats across the test.
export async function sampleModuleQuestions(params: {
  sections: Section[];
  mix: Record<string, Partial<Record<number, number>>>;
  exclude?: string[];
}): Promise<string[]> {
  await ensureLoaded();
  const sectionSet = new Set(params.sections);
  const taken = new Set(params.exclude ?? []);
  const result: string[] = [];

  const take = (qs: Question[]) => {
    for (const q of qs) {
      taken.add(q.id);
      result.push(q.id);
    }
  };

  for (const [skill, cell] of Object.entries(params.mix)) {
    for (const [dStr, want] of Object.entries(cell)) {
      const d = Number(dStr);
      const need = want ?? 0;
      if (need <= 0) continue;
      const exact = state.cache!.filter(
        (q) =>
          sectionSet.has(q.section) &&
          q.skill === skill &&
          q.difficulty === d &&
          !taken.has(q.id),
      );
      const picked = pickRandom(exact, need);
      take(picked);
      const short = need - picked.length;
      if (short > 0) {
        const alt = state.cache!.filter(
          (q) => sectionSet.has(q.section) && q.skill === skill && !taken.has(q.id),
        );
        take(pickRandom(alt, short));
      }
    }
  }
  return result;
}

// Return up to `limit` not-yet-served questions in the given sections, sampled
// randomly so the adaptive picker sees a varied slate each turn.
export async function sampleCandidates(
  sections: Section[],
  served: string[],
  limit: number,
): Promise<Question[]> {
  await ensureLoaded();
  const servedSet = new Set(served);
  const sectionSet = new Set(sections);

  const pool = state.cache!.filter(
    (q) => sectionSet.has(q.section) && !servedSet.has(q.id),
  );
  if (pool.length <= limit) return pool;

  // Partial Fisher–Yates: shuffle only the first `limit` slots.
  const picks = pool.slice();
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(Math.random() * (picks.length - i));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, limit);
}

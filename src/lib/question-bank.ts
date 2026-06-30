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

// Distinct skills + difficulties present in the bank, for building the
// tutor's assignment form. Skills are returned sorted.
export async function bankFacets(): Promise<{
  skills: string[];
  difficulties: number[];
}> {
  await ensureLoaded();
  const skills = new Set<string>();
  const difficulties = new Set<number>();
  for (const q of state.cache!) {
    skills.add(q.skill);
    difficulties.add(q.difficulty);
  }
  return {
    skills: [...skills].sort(),
    difficulties: [...difficulties].sort((a, b) => a - b),
  };
}

// Randomly sample up to `count` questions matching the given criteria. Empty
// skills/difficulties mean "any". Returns the chosen question ids.
export async function sampleByCriteria(criteria: {
  skills: string[];
  difficulties: number[];
  count: number;
}): Promise<string[]> {
  await ensureLoaded();
  const skillSet = new Set(criteria.skills);
  const diffSet = new Set(criteria.difficulties);
  const pool = state.cache!.filter(
    (q) =>
      (skillSet.size === 0 || skillSet.has(q.skill)) &&
      (diffSet.size === 0 || diffSet.has(q.difficulty)),
  );
  // Partial Fisher–Yates for the first `count` slots.
  const n = Math.min(criteria.count, pool.length);
  const picks = pool.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (picks.length - i));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, n).map((q) => q.id);
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

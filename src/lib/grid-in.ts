// Grading + normalization for grid-in (student-typed, free-response) math
// answers. Pure and dependency-free so it's safe to import on both the server
// (grading) and the client (input validation/display).
//
// SAT grid-in answers are integers, decimals, or fractions (e.g. "700", "-5",
// "-9/8", ".375"). A student may enter an equivalent form (a fraction as a
// decimal, or a rounded repeating decimal), so we compare by numeric value —
// not just string equality.

import type { QuestionType } from "@/lib/types";

const ANSWER_KEYS = new Set(["A", "B", "C", "D"]);

export function normalizeGridIn(s: string): string {
  return (s ?? "").trim().replace(/\s+/g, "").replace(/^\+/, "");
}

// Parse a normalized grid-in string to a number, or null if it isn't one.
function toNumber(s: string): number | null {
  const t = normalizeGridIn(s);
  if (!t) return null;
  if (/^-?\d*\.?\d+$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const frac = t.match(/^(-?\d+)\/(-?\d+)$/);
  if (frac) {
    const d = Number(frac[2]);
    if (d !== 0) {
      const n = Number(frac[1]) / d;
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// True if the student's typed answer matches the stored correct answer, allowing
// numerically-equivalent forms (fraction↔decimal, and 3+ dp roundings of
// repeating decimals, matching the SAT's grid tolerance).
export function gridInCorrect(
  input: string | null | undefined,
  correct: string,
): boolean {
  if (input == null) return false;
  const a = normalizeGridIn(input);
  if (!a) return false;
  const b = normalizeGridIn(correct);
  if (a.toLowerCase() === b.toLowerCase()) return true;

  const na = toNumber(a);
  const nb = toNumber(b);
  if (na == null || nb == null) return false;
  if (Math.abs(na - nb) < 1e-9) return true;
  // Accept a 3-decimal rounding/truncation (e.g. .333 for 1/3).
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return r3(na) === r3(nb);
}

// Grade one raw answer against a question. Returns the cleaned answer to record
// (null = unanswered) and whether it's correct. Handles both mcq (must be a
// valid A–D key) and grid_in (normalized + numerically compared). Single source
// of truth shared by the session and practice-test engines.
export function gradeAnswer(
  q: { type: QuestionType; correctAnswer: string },
  raw: string | null | undefined,
): { your: string | null; correct: boolean } {
  if (q.type === "grid_in") {
    const norm = raw == null ? "" : normalizeGridIn(raw);
    const your = norm ? norm : null;
    return { your, correct: your != null && gridInCorrect(your, q.correctAnswer) };
  }
  const your = typeof raw === "string" && ANSWER_KEYS.has(raw) ? raw : null;
  return { your, correct: your != null && your === q.correctAnswer };
}

// Whether a raw draft value is a valid (non-empty) answer for a question type —
// used to filter autosaved drafts. Doesn't check correctness.
export function isValidDraftAnswer(type: QuestionType, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  if (type === "grid_in") return normalizeGridIn(raw) !== "";
  return ANSWER_KEYS.has(raw);
}

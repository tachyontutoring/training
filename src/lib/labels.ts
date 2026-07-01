// Small client-safe helpers for displaying skills/subskills and mastery.
// No server (Admin SDK) imports — safe to use in client components.

// Turn a subskill code like "COE_QUANT_COMPLETE" into "Quant complete".
export function humanizeSubSkill(code: string): string {
  const parts = code.split("_");
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  const s = rest.join(" ").toLowerCase().trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : code;
}

export type MasteryLevel =
  | "Untested"
  | "Started"
  | "Needs work"
  | "Developing"
  | "Proficient"
  | "Mastered";

export interface Mastery {
  level: MasteryLevel;
  pct: number;
  // Tailwind classes for a badge — kept literal so they survive purging.
  badge: string;
}

/**
 * A simple mastery model combining accuracy with volume. A skill needs a
 * minimum number of attempts before it's assessed (otherwise it's "Started"),
 * then accuracy buckets it. Tune the thresholds in MASTERY_MIN / the cutoffs.
 */
export const MASTERY_MIN_ATTEMPTS = 4;

export function mastery(answered: number, correct: number): Mastery {
  const pct = answered ? Math.round((correct / answered) * 100) : 0;
  if (answered === 0) return { level: "Untested", pct, badge: "bg-slate-100 text-slate-500" };
  if (answered < MASTERY_MIN_ATTEMPTS)
    return { level: "Started", pct, badge: "bg-slate-100 text-slate-600" };
  if (pct >= 90) return { level: "Mastered", pct, badge: "bg-green-100 text-green-700" };
  if (pct >= 75) return { level: "Proficient", pct, badge: "bg-emerald-100 text-emerald-700" };
  if (pct >= 50) return { level: "Developing", pct, badge: "bg-amber-100 text-amber-700" };
  return { level: "Needs work", pct, badge: "bg-rose-100 text-rose-700" };
}

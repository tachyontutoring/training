// Adaptive tutor brain. Given the learner's recent performance and a set of
// candidate questions, Claude chooses which question to serve next and writes
// a short coaching note. If no ANTHROPIC_API_KEY is configured (e.g. local
// emulator dev), we fall back to a deterministic difficulty heuristic.
import Anthropic from "@anthropic-ai/sdk";
import type { ProgressStats, ResponseDoc, Section } from "@/lib/types";

export interface Candidate {
  id: string;
  section: Section;
  skill: string;
  difficulty: number;
}

export interface NextPick {
  questionId: string;
  coaching: string;
  source: "claude" | "heuristic";
}

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export async function pickNextQuestion(args: {
  candidates: Candidate[];
  recent: ResponseDoc[];
  progress: ProgressStats;
  lastCorrect: boolean | null;
}): Promise<NextPick> {
  const { candidates, recent, progress, lastCorrect } = args;
  if (candidates.length === 0) {
    return { questionId: "", coaching: "", source: "heuristic" };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await pickWithClaude(args);
    } catch (err) {
      console.error("[claude] falling back to heuristic:", err);
    }
  }
  void recent; // used only by the Claude path above
  return {
    ...heuristicPick(candidates, progress, lastCorrect),
    source: "heuristic",
  };
}

async function pickWithClaude(args: {
  candidates: Candidate[];
  recent: ResponseDoc[];
  progress: ProgressStats;
  lastCorrect: boolean | null;
}): Promise<NextPick> {
  const { candidates, recent, progress, lastCorrect } = args;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const accuracy = (a: number, c: number) =>
    a === 0 ? "n/a" : `${Math.round((c / a) * 100)}%`;

  const skillLines = Object.entries(progress.bySkill)
    .map(([s, v]) => `  - ${s}: ${accuracy(v.answered, v.correct)} (${v.answered} attempted)`)
    .join("\n");

  const recentLines = recent
    .slice(-8)
    .map(
      (r) =>
        `  - ${r.section}/${r.skill} (diff ${r.difficulty}): ${r.correct ? "correct" : "wrong"}`,
    )
    .join("\n");

  const candidateLines = candidates
    .map((c) => `  - id=${c.id} | ${c.section}/${c.skill} | difficulty ${c.difficulty}`)
    .join("\n");

  const system =
    "You are the adaptive engine for an SAT prep tutor named Tachyon. " +
    "You select the single best next question for a learner to maximize learning: " +
    "reinforce weak skills, calibrate difficulty to keep them challenged but not " +
    "demoralized, and vary skills. Reply with ONLY a JSON object, no prose.";

  const prompt = `Last answer: ${lastCorrect === null ? "n/a (start of session)" : lastCorrect ? "CORRECT" : "WRONG"}

Overall accuracy: ${accuracy(progress.totalAnswered, progress.totalCorrect)} over ${progress.totalAnswered} questions.

Per-skill accuracy:
${skillLines || "  (none yet)"}

Recent answers (oldest→newest):
${recentLines || "  (none yet)"}

Candidate questions to choose from:
${candidateLines}

Choose exactly one candidate by its id. Respond with JSON:
{"questionId": "<one of the candidate ids>", "coaching": "<one or two encouraging, specific sentences for the learner about what to focus on next>"}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  const valid = candidates.find((c) => c.id === parsed?.questionId);
  if (!valid) throw new Error(`Claude returned unknown id: ${parsed?.questionId}`);

  return {
    questionId: valid.id,
    coaching: typeof parsed?.coaching === "string" ? parsed.coaching : "",
    source: "claude",
  };
}

function extractJson(text: string): { questionId?: string; coaching?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Deterministic fallback: target the weakest skill, nudge difficulty by the
// last result, and pick the closest candidate.
function heuristicPick(
  candidates: Candidate[],
  progress: ProgressStats,
  lastCorrect: boolean | null,
): Omit<NextPick, "source"> {
  const lastDiff =
    candidates.reduce((s, c) => s + c.difficulty, 0) / candidates.length;
  let targetDiff = Math.round(lastDiff);
  if (lastCorrect === true) targetDiff += 1;
  if (lastCorrect === false) targetDiff -= 1;
  targetDiff = Math.max(1, Math.min(5, targetDiff));

  // Find weakest skill among candidates (lowest accuracy, ties broken by least attempted).
  const skillsPresent = [...new Set(candidates.map((c) => c.skill))];
  skillsPresent.sort((a, b) => {
    const va = progress.bySkill[a] ?? { answered: 0, correct: 0 };
    const vb = progress.bySkill[b] ?? { answered: 0, correct: 0 };
    const accA = va.answered ? va.correct / va.answered : 1.1;
    const accB = vb.answered ? vb.correct / vb.answered : 1.1;
    if (accA !== accB) return accA - accB;
    return va.answered - vb.answered;
  });
  const targetSkill = skillsPresent[0];

  const pool = candidates.filter((c) => c.skill === targetSkill);
  const search = pool.length ? pool : candidates;
  search.sort(
    (a, b) =>
      Math.abs(a.difficulty - targetDiff) - Math.abs(b.difficulty - targetDiff),
  );

  return {
    questionId: search[0].id,
    coaching:
      lastCorrect === false
        ? `Let's revisit ${targetSkill} — slow down and check each step.`
        : `Nice work. Building on ${targetSkill} next at difficulty ${targetDiff}.`,
  };
}

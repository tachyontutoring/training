/**
 * Seeds the Firestore `questions` collection from the tachyontutoring/questions
 * repo — specifically the **Claude-generated Reading & Writing** bank
 * (data/rw/rw-qbank-generated.json). Official CollegeBoard banks are NOT used.
 *
 * Figures ARE included:
 *   - Graph questions (stimulus_image) → their PNG is copied into
 *     public/figures/ and the question stores stimulusImage="/figures/<file>".
 *   - Table questions (stimulus_latex, no image) → the LaTeX tabular is
 *     converted to sanitized HTML stored in stimulusTableHtml.
 * Anything malformed (or a table we can't convert) is skipped and logged.
 *
 * Usage:
 *   pnpm seed                                       # -> real project (needs FIREBASE_SERVICE_ACCOUNT_B64)
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 pnpm seed   # -> local emulator
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { basename, join } from "node:path";
import { config } from "dotenv";
import { initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

config({ path: ".env.local" });

type AnswerKey = "A" | "B" | "C" | "D";

// Shape of one record in rw-qbank-generated.json (only fields we use).
interface SourceQuestion {
  question_id: string;
  test: string;
  domain: string;
  skill: string;
  sub_skill: string;
  targeted_ability: string;
  difficulty: "Easy" | "Medium" | "Hard";
  stimulus_type?: string | null;
  stimulus_image?: string | null;
  stimulus_latex?: string | null;
  passage: string;
  question: string;
  choices: Record<string, string>;
  correct_answer: string;
  rationale: string;
}

const DIFFICULTY_MAP: Record<string, 2 | 3 | 4> = {
  Easy: 2,
  Medium: 3,
  Hard: 4,
};

const SOURCE_PATH =
  process.env.RW_QUESTIONS_PATH ||
  "/Users/ck/Development/questions/data/rw/rw-qbank-generated.json";

// Directory holding the compiled figure PNGs (stimulus_image is relative to the
// questions repo's site/ dir, e.g. "img/GEN-...png").
const IMG_SRC_DIR =
  process.env.RW_IMG_DIR || "/Users/ck/Development/questions/site/img";
const FIGURES_OUT_DIR = join(process.cwd(), "public", "figures");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Reduce a single LaTeX table cell to safe HTML. Handles the small command set
// the bank actually uses: \textbf, \textsuperscript, \degree/\textdegree.
function cellToHtml(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\\textsuperscript\{([^}]*)\}/g, (_m, x) => `__SUP__${x}__/SUP__`);
  s = s.replace(/\\textbf\{([^}]*)\}/g, (_m, x) => `__B__${x}__/B__`);
  s = s.replace(/\\(?:textdegree|degree)\b\{?\}?/g, "°");
  // Drop any remaining \cmd{...} wrappers, keeping their contents.
  s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1");
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = escapeHtml(s);
  s = s
    .replace(/__SUP__/g, "<sup>")
    .replace(/__\/SUP__/g, "</sup>")
    .replace(/__B__/g, "<strong>")
    .replace(/__\/B__/g, "</strong>");
  return s.trim();
}

// Convert a \sattitle + tabular LaTeX stimulus into an HTML <table>. Returns
// null if the structure can't be parsed.
function latexTableToHtml(latex: string): string | null {
  try {
    const titleMatch = latex.match(/\\sattitle\{([^}]*)\}/);
    const title = titleMatch ? cellToHtml(titleMatch[1]) : "";

    const begin = latex.indexOf("\\begin{tabular}");
    const end = latex.indexOf("\\end{tabular}");
    if (begin === -1 || end === -1) return null;

    // The column spec right after \begin{tabular} contains nested braces
    // (e.g. {|L{3cm}|C{3.2cm}|}); skip it by brace-matching rather than regex.
    let i = latex.indexOf("{", begin + "\\begin{tabular}".length);
    if (i === -1 || i > end) return null;
    let depth = 0;
    let specEnd = -1;
    for (; i < end; i++) {
      if (latex[i] === "{") depth++;
      else if (latex[i] === "}") {
        depth--;
        if (depth === 0) {
          specEnd = i;
          break;
        }
      }
    }
    if (specEnd === -1) return null;
    const bodyText = latex.slice(specEnd + 1, end);

    const rows = bodyText
      .replace(/\\hline/g, "")
      .split(/\\\\(?:\[[^\]]*\])?/) // row separator, optional \\[1ex]
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (rows.length === 0) return null;

    const htmlRows = rows.map((row) => {
      const cells = row.split(/(?<!\\)&/).map((c) => cellToHtml(c));
      return cells;
    });

    const head = htmlRows[0];
    const bodyRows = htmlRows.slice(1);
    const thead = `<thead><tr>${head
      .map((c) => `<th>${c}</th>`)
      .join("")}</tr></thead>`;
    const tbody = `<tbody>${bodyRows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody>`;
    const caption = title ? `<caption>${title}</caption>` : "";
    return `<table>${caption}${thead}${tbody}</table>`;
  } catch {
    return null;
  }
}

function buildApp(): App {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "athens-6174e";
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const usingEmulator =
    !!process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1";

  if (usingEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }

  if (b64) {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return initializeApp({ credential: cert(json), projectId: json.project_id });
  }
  if (usingEmulator) return initializeApp({ projectId });

  throw new Error(
    "No credentials. Set FIREBASE_SERVICE_ACCOUNT_B64 in .env.local, or run " +
      "with NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 against the emulator.",
  );
}

// Counters for the run summary.
let copiedImages = 0;
let convertedTables = 0;

function transform(src: SourceQuestion) {
  const keys = Object.keys(src.choices).sort();
  const choices = keys.map((k) => ({ key: k as AnswerKey, text: src.choices[k] }));

  let stimulusImage: string | null = null;
  if (src.stimulus_image) {
    const file = basename(src.stimulus_image);
    const from = join(IMG_SRC_DIR, file);
    if (existsSync(from)) {
      copyFileSync(from, join(FIGURES_OUT_DIR, file));
      stimulusImage = `/figures/${file}`;
      copiedImages++;
    }
  }

  let stimulusTableHtml: string | null = null;
  if (!stimulusImage && src.stimulus_latex) {
    stimulusTableHtml = latexTableToHtml(src.stimulus_latex);
    if (stimulusTableHtml) convertedTables++;
  }

  return {
    section: "reading" as const,
    skill: src.skill,
    subSkill: src.sub_skill,
    domain: src.domain,
    targetedAbility: src.targeted_ability,
    difficulty: DIFFICULTY_MAP[src.difficulty] ?? 3,
    prompt: src.question,
    passage: src.passage ?? "",
    stimulusImage,
    stimulusTableHtml,
    choices,
    correctAnswer: src.correct_answer as AnswerKey,
    explanation: src.rationale,
    source: "generated-rw",
    // Random key so the app can pull a varied candidate pool cheaply.
    rand: Math.random(),
  };
}

// A question is usable if it has valid A–D choices, a correct answer, a prompt,
// and *some* stimulus — a passage, a graph image, or a convertible table.
function usable(q: SourceQuestion): boolean {
  const keys = Object.keys(q.choices || {}).sort().join("");
  if (keys !== "ABCD") return false;
  if (!["A", "B", "C", "D"].includes(q.correct_answer)) return false;
  if (!q.question) return false;
  const hasPassage = !!(q.passage && q.passage.trim());
  const hasImage = !!(q.stimulus_image && existsSync(join(IMG_SRC_DIR, basename(q.stimulus_image))));
  const hasTable =
    !q.stimulus_image && !!q.stimulus_latex && latexTableToHtml(q.stimulus_latex) !== null;
  return hasPassage || hasImage || hasTable;
}

async function main() {
  const raw = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));
  const all: SourceQuestion[] = raw.questions ?? raw;
  console.log(`Loaded ${all.length} generated RW questions from ${SOURCE_PATH}`);

  mkdirSync(FIGURES_OUT_DIR, { recursive: true });

  const keep = all.filter(usable);
  const skipped = all.length - keep.length;

  // Build the full records once (this also copies images / converts tables).
  const records = keep.map((src) => ({
    id: src.question_id.replace(/[^A-Za-z0-9_-]/g, "_"),
    ...transform(src),
  }));

  // SNAPSHOT_ONLY=1 rebuilds the local snapshot + figures without touching
  // Firestore (useful when the bank is already seeded and you want to avoid
  // read/write quota usage).
  const snapshotOnly = process.env.SNAPSHOT_ONLY === "1";
  let written = 0;
  if (!snapshotOnly) {
    const db = getFirestore(buildApp());
    const CHUNK = 400; // Firestore batches are capped at 500 writes.
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK);
      const batch = db.batch();
      for (const rec of slice) {
        const { id, ...data } = rec;
        batch.set(db.collection("questions").doc(id), data);
      }
      await batch.commit();
      written += slice.length;
      console.log(`  committed ${written}/${records.length}`);
    }
  }

  // Write a local snapshot the app loads at runtime, so serving questions
  // never costs Firestore reads (the bank is static reference data).
  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "question-bank.json"), JSON.stringify(records));

  console.log(
    (snapshotOnly
      ? `Snapshot-only: skipped Firestore writes.`
      : `Seeded ${written} questions to Firestore.`) +
      ` ${copiedImages} graph images copied, ${convertedTables} tables converted, ` +
      `${skipped} skipped.\n` +
      `Wrote local snapshot data/question-bank.json (${records.length} questions).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

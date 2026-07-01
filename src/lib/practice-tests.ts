// ---------------------------------------------------------------------------
// Practice-test infrastructure.
//
// A practice test is a sequence of timed MODULES. Each module pulls questions
// from our own bank according to a SelectionRule. The digital SAT is
// section-adaptive: Module 2 of each section is EASIER or HARDER depending on
// how the student did on Module 1 — modelled here by `tiers` + a threshold.
//
// The per-module DISTRIBUTIONS below are a PROPOSED starting point (generated
// from the bank inventory + official SAT domain weights). They are meant to be
// tweaked — edit the *_MIX tables and nothing else needs to change.
// ---------------------------------------------------------------------------
import type { AnswerKey, Section } from "./types";

export const DIFFICULTY = { EASY: 2, MEDIUM: 3, HARD: 4 } as const;
export type Difficulty = (typeof DIFFICULTY)[keyof typeof DIFFICULTY];

// skill -> { difficulty: howMany }. The sum across all cells is the module size.
export type SkillDifficultyMix = Record<string, Partial<Record<Difficulty, number>>>;

// How to pick the questions for one module from the bank.
export interface SelectionRule {
  sections: Section[];
  skillDifficultyMix: SkillDifficultyMix;
}

export interface PracticeModule {
  id: string;
  title: string;
  section: Section;
  timeMs: number;
  // A fixed rule (Module 1)...
  rule?: SelectionRule;
  // ...or adaptive: which earlier module's score sets the tier. At/above
  // `hardTierThreshold` (fraction correct) the student gets the hard module.
  adaptiveFrom?: string;
  hardTierThreshold?: number;
  tiers?: { easy: SelectionRule; hard: SelectionRule };
}

export interface PracticeTestBlueprint {
  id: string;
  title: string;
  modules: PracticeModule[];
}

export function ruleSize(rule: SelectionRule): number {
  let n = 0;
  for (const cell of Object.values(rule.skillDifficultyMix)) {
    for (const c of Object.values(cell)) n += c ?? 0;
  }
  return n;
}

const MIN = 60 * 1000;

// --- PROPOSED distributions (tweak these) ----------------------------------
// Reading & Writing (27 per module).
const RW_M1: SkillDifficultyMix = {
  "Command of Evidence": { 2: 1, 3: 2, 4: 1 },
  "Words in Context": { 2: 1, 3: 1, 4: 1 },
  "Rhetorical Synthesis": { 2: 1, 3: 1, 4: 1 },
  "Form, Structure, and Sense": { 2: 1, 3: 1, 4: 1 },
  Boundaries: { 2: 1, 3: 1, 4: 1 },
  Transitions: { 2: 1, 3: 1, 4: 1 },
  "Text Structure and Purpose": { 2: 1, 3: 1, 4: 1 },
  "Central Ideas and Details": { 2: 1, 3: 1 },
  Inferences: { 2: 1, 3: 1 },
  "Cross-Text Connections": { 4: 1 },
};
const RW_M2_EASY: SkillDifficultyMix = {
  "Command of Evidence": { 2: 2, 3: 1, 4: 1 },
  "Words in Context": { 2: 2, 3: 1 },
  "Rhetorical Synthesis": { 2: 2, 3: 1 },
  "Form, Structure, and Sense": { 2: 2, 3: 1 },
  Boundaries: { 2: 2, 3: 1 },
  Transitions: { 2: 2, 3: 1 },
  "Text Structure and Purpose": { 2: 2, 3: 1 },
  "Central Ideas and Details": { 2: 1, 3: 1 },
  Inferences: { 2: 1, 3: 1 },
  "Cross-Text Connections": { 2: 1 },
};
const RW_M2_HARD: SkillDifficultyMix = {
  "Command of Evidence": { 2: 1, 3: 2, 4: 1 },
  "Words in Context": { 3: 1, 4: 2 },
  "Rhetorical Synthesis": { 3: 1, 4: 2 },
  "Form, Structure, and Sense": { 3: 1, 4: 2 },
  Boundaries: { 3: 1, 4: 2 },
  Transitions: { 3: 1, 4: 2 },
  "Text Structure and Purpose": { 3: 1, 4: 2 },
  "Central Ideas and Details": { 3: 1, 4: 1 },
  Inferences: { 3: 1, 4: 1 },
  "Cross-Text Connections": { 4: 1 },
};

// Math (21 per module — bump toward 22 once Problem-Solving/Data-Analysis
// content exists in the bank; it's currently absent).
const MATH_M1: SkillDifficultyMix = {
  "Nonlinear functions": { 2: 1, 3: 1, 4: 1 },
  "Linear functions": { 2: 1, 3: 1 },
  "Nonlinear equations in one variable and systems of equations in two variables": { 2: 1, 3: 1 },
  "Equivalent expressions": { 2: 1, 3: 1 },
  "Linear equations in two variables": { 2: 1, 3: 1 },
  "Systems of two linear equations in two variables": { 2: 1, 3: 1 },
  "Linear equations in one variable": { 2: 1, 3: 1 },
  "Area and volume": { 2: 1, 3: 1 },
  "Right triangles and trigonometry": { 2: 1, 3: 1 },
  "Linear inequalities in one or two variables": { 4: 1 },
  "Lines, angles, and triangles": { 4: 1 },
};
const MATH_M2_EASY: SkillDifficultyMix = {
  "Nonlinear functions": { 2: 2, 3: 1 },
  "Linear functions": { 2: 1, 3: 1 },
  "Nonlinear equations in one variable and systems of equations in two variables": { 2: 1, 3: 1 },
  "Equivalent expressions": { 2: 1, 3: 1 },
  "Linear equations in two variables": { 2: 1, 3: 1 },
  "Systems of two linear equations in two variables": { 2: 1, 3: 1 },
  "Linear equations in one variable": { 2: 1, 3: 1 },
  "Area and volume": { 2: 1, 3: 1 },
  "Right triangles and trigonometry": { 2: 1, 3: 1 },
  "Linear inequalities in one or two variables": { 2: 1 },
  "Lines, angles, and triangles": { 2: 1 },
};
const MATH_M2_HARD: SkillDifficultyMix = {
  "Nonlinear functions": { 3: 1, 4: 2 },
  "Linear functions": { 3: 1, 4: 1 },
  "Nonlinear equations in one variable and systems of equations in two variables": { 3: 1, 4: 1 },
  "Equivalent expressions": { 3: 1, 4: 1 },
  "Linear equations in two variables": { 3: 1, 4: 1 },
  "Systems of two linear equations in two variables": { 3: 1, 4: 1 },
  "Linear equations in one variable": { 3: 1, 4: 1 },
  "Area and volume": { 3: 1, 4: 1 },
  "Right triangles and trigonometry": { 3: 1, 4: 1 },
  "Linear inequalities in one or two variables": { 4: 1 },
  "Lines, angles, and triangles": { 4: 1 },
};

export const BLUEPRINTS: PracticeTestBlueprint[] = [
  {
    id: "sat-practice-1",
    title: "Full Practice Test 1",
    modules: [
      {
        id: "rw-m1",
        title: "Reading & Writing — Module 1",
        section: "reading",
        timeMs: 32 * MIN,
        rule: { sections: ["reading"], skillDifficultyMix: RW_M1 },
      },
      {
        id: "rw-m2",
        title: "Reading & Writing — Module 2",
        section: "reading",
        timeMs: 32 * MIN,
        adaptiveFrom: "rw-m1",
        hardTierThreshold: 0.6,
        tiers: {
          easy: { sections: ["reading"], skillDifficultyMix: RW_M2_EASY },
          hard: { sections: ["reading"], skillDifficultyMix: RW_M2_HARD },
        },
      },
      {
        id: "math-m1",
        title: "Math — Module 1",
        section: "math",
        timeMs: 35 * MIN,
        rule: { sections: ["math"], skillDifficultyMix: MATH_M1 },
      },
      {
        id: "math-m2",
        title: "Math — Module 2",
        section: "math",
        timeMs: 35 * MIN,
        adaptiveFrom: "math-m1",
        hardTierThreshold: 0.6,
        tiers: {
          easy: { sections: ["math"], skillDifficultyMix: MATH_M2_EASY },
          hard: { sections: ["math"], skillDifficultyMix: MATH_M2_HARD },
        },
      },
    ],
  },
];

export function getBlueprint(id: string): PracticeTestBlueprint | undefined {
  return BLUEPRINTS.find((b) => b.id === id);
}

// ---------------------------------------------------------------------------
// Runtime session shapes (stored at users/{uid}/practiceTests/{id}).
// ---------------------------------------------------------------------------
export interface PTModuleState {
  id: string;
  title: string;
  section: Section;
  timeMs: number;
  tier: "easy" | "hard" | null; // set for adaptive modules once assembled
  questionIds: string[] | null; // null until the module is reached/assembled
  answers: Record<string, AnswerKey>;
  status: "pending" | "active" | "submitted";
  answered: number;
  correct: number;
  timeSpentMs: number;
}

export interface PracticeTestSession {
  id: string;
  blueprintId: string;
  title: string;
  createdAt: number;
  status: "active" | "completed";
  currentModuleIndex: number;
  modules: PTModuleState[];
  totalAnswered: number;
  totalCorrect: number;
  completedAt?: number | null;
}

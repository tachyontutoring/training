// Shared domain types for School of Athens.

export type Section = "reading" | "math";
export type TestType = "full" | "reading" | "math";
export type AnswerKey = "A" | "B" | "C" | "D";
export type Role = "student" | "tutor";

// Stored at users/{uid}. Created on first login via /api/me.
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  tutorId?: string | null; // for students: the tutor who owns their roster entry
  createdAt: number;
}

export interface AssignmentCriteria {
  sections: Section[]; // empty = any section (reading | math)
  skills: string[]; // empty = any skill
  subSkills: string[]; // empty = any subskill (within the chosen skills)
  difficulties: number[]; // empty = any difficulty (values among 2,3,4)
  count: number;
}

export interface Assignment {
  id: string;
  tutorId: string;
  studentId: string;
  title: string;
  criteria: AssignmentCriteria;
  questionIds: string[];
  createdAt: number;
  status: "assigned" | "completed";
  // Filled in when the student finishes the set.
  answered: number;
  correct: number;
  totalTimeMs: number;
  completedAt?: number | null;
  sessionId?: string | null;
}

export interface Choice {
  key: AnswerKey;
  text: string;
}

// A question as stored in Firestore (the full record, server-side only).
export interface Question {
  id: string;
  section: Section;
  skill: string; // e.g. "Linear equations", "Words in context"
  subSkill?: string | null; // finer-grained tag, e.g. "COE_QUANT_COMPLETE"
  domain?: string | null; // College Board domain grouping
  difficulty: 1 | 2 | 3 | 4 | 5;
  passage?: string; // reading questions usually carry a passage
  stimulusImage?: string | null; // public path to a graph/figure PNG
  stimulusTableHtml?: string | null; // pre-rendered HTML for table stimuli
  prompt: string;
  choices: Choice[];
  correctAnswer: AnswerKey;
  explanation: string;
}

// The shape sent to the browser — never includes the answer or explanation.
export type PublicQuestion = Omit<Question, "correctAnswer" | "explanation">;

export function toPublicQuestion(q: Question): PublicQuestion {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { correctAnswer, explanation, ...pub } = q;
  return pub;
}

export interface SessionDoc {
  id: string;
  type: TestType;
  createdAt: number;
  status: "active" | "completed";
  targetCount: number; // how many questions this session aims for
  answered: number;
  correct: number;
  totalTimeMs: number; // cumulative time spent answering this session
  servedQuestionIds: string[]; // questions already shown this session
  currentQuestionId: string | null;
  // Present when this session is a tutor-assigned practice set: questions are
  // served from `queue` in order rather than chosen adaptively.
  assignmentId?: string | null;
  queue?: string[] | null;
  // Bluebook-style free navigation: ungraded answer drafts + marks + position,
  // autosaved as the student works so a set can be left and resumed. Graded
  // only when the whole set is submitted.
  draftAnswers?: Record<string, AnswerKey> | null;
  markedQuestionIds?: string[] | null;
  currentIndex?: number | null;
}

export interface ResponseDoc {
  questionId: string;
  section: Section;
  skill: string;
  subSkill?: string | null;
  difficulty: number;
  selectedAnswer: AnswerKey;
  correct: boolean;
  answeredAt: number;
  timeMs: number; // time the learner spent on this question
}

// Aggregate progress kept on users/{uid} for dashboards.
export interface ProgressStats {
  totalAnswered: number;
  totalCorrect: number;
  bySection: Record<Section, { answered: number; correct: number }>;
  bySkill: Record<string, { answered: number; correct: number }>;
  bySubSkill: Record<string, { answered: number; correct: number }>;
  updatedAt: number;
}

export function emptyProgress(): ProgressStats {
  return {
    totalAnswered: 0,
    totalCorrect: 0,
    bySection: {
      reading: { answered: 0, correct: 0 },
      math: { answered: 0, correct: 0 },
    },
    bySkill: {},
    bySubSkill: {},
    updatedAt: 0,
  };
}

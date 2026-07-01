// Client-safe types. These mirror server shapes but live in a module that
// never imports the Admin SDK, so importing them into client components is safe.
export type {
  AnswerKey,
  Choice,
  PublicQuestion,
  Section,
  SessionDoc,
  TestType,
  ProgressStats,
  Role,
  UserProfile,
  Assignment,
  AssignmentCriteria,
} from "@/lib/types";

import type { AnswerKey, PublicQuestion, SessionDoc } from "@/lib/types";

// Matches the JSON returned by POST /api/answer.
export interface GradeResultClient {
  correct: boolean;
  correctAnswer: AnswerKey;
  explanation: string;
  coaching: string;
  session: SessionDoc;
  next: PublicQuestion | null;
  finished: boolean;
}

// GET /api/session/:id — full state for the Bluebook-style runner.
export interface SessionFullClient {
  session: SessionDoc;
  questions: PublicQuestion[];
  answers: Record<string, AnswerKey>;
  marked: string[];
  currentIndex: number;
}

// One graded question, returned by POST /api/session/:id/submit.
export interface SubmittedQuestionClient {
  questionId: string;
  yourAnswer: AnswerKey | null;
  correctAnswer: AnswerKey;
  correct: boolean;
  explanation: string;
}
export interface SubmitResultClient {
  session: SessionDoc;
  results: SubmittedQuestionClient[];
}

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

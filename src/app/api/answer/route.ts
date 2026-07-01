import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { submitAnswer } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const body = await req.json().catch(() => ({}));
    const { sessionId, questionId, selectedAnswer, timeMs } = body ?? {};

    // selectedAnswer is an A–D key (mcq) or a typed value (grid-in); the grader
    // validates it against the question. Reject only empty/non-string here.
    if (
      typeof sessionId !== "string" ||
      typeof questionId !== "string" ||
      typeof selectedAnswer !== "string" ||
      selectedAnswer.trim() === ""
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Clamp the client-reported time to a sane range (0 – 1 hour).
    const safeTimeMs =
      typeof timeMs === "number" && Number.isFinite(timeMs)
        ? Math.max(0, Math.min(timeMs, 3_600_000))
        : 0;

    const result = await submitAnswer(
      uid,
      sessionId,
      questionId,
      selectedAnswer,
      safeTimeMs,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/answer]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

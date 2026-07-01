import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import {
  startAssignedPracticeTest,
  listPracticeSummaries,
} from "@/lib/practice-service";

export const runtime = "nodejs";

// The signed-in student's own practice tests (most recent first).
export async function GET(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const tests = await listPracticeSummaries(uid);
    return NextResponse.json({ tests });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/practice-test GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

// Launch (or resume) a tutor-assigned practice test. Body: { assignmentId }.
// Practice tests are assignable ONLY by a tutor — there is no self-serve path,
// so this requires a practice-test assignment that belongs to the caller.
export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const body = await req.json().catch(() => ({}));
    const assignmentId = typeof body?.assignmentId === "string" ? body.assignmentId : "";
    if (!assignmentId) {
      return NextResponse.json(
        { error: "A practice test must be assigned by your tutor." },
        { status: 400 },
      );
    }
    const id = await startAssignedPracticeTest(uid, assignmentId);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/practice-test]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { createPracticeTest } from "@/lib/practice-service";

export const runtime = "nodejs";

// Start a new practice test. Body: { blueprintId }.
export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const body = await req.json().catch(() => ({}));
    const blueprintId =
      typeof body?.blueprintId === "string" ? body.blueprintId : "sat-practice-1";
    const id = await createPracticeTest(uid, blueprintId);
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

import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { submitSession } from "@/lib/session-service";

export const runtime = "nodejs";

// Grade a whole set at once (end of a Bluebook-style run).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const uid = await requireUid(req);
    const { sessionId } = await params;
    const body = await req.json().catch(() => ({}));
    const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
    const times = body?.times && typeof body.times === "object" ? body.times : {};
    const result = await submitSession(uid, sessionId, answers, times);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/session/:id/submit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

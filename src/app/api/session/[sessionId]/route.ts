import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { getSession } from "@/lib/session-service";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const uid = await requireUid(req);
    const { sessionId } = await params;
    const result = await getSession(uid, sessionId);
    if (!result) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/session/:id]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

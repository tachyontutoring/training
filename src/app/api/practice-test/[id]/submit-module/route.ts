import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { submitModule } from "@/lib/practice-service";

export const runtime = "nodejs";

// Grade the current module and advance (or finish the test).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await requireUid(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const answers = body?.answers && typeof body.answers === "object" ? body.answers : {};
    const times = body?.times && typeof body.times === "object" ? body.times : {};
    const view = await submitModule(uid, id, answers, times);
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/practice-test/:id/submit-module]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

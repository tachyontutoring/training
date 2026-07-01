import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { getPracticeTest, savePracticeDraft } from "@/lib/practice-service";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await requireUid(req);
    const { id } = await params;
    const view = await getPracticeTest(uid, id);
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/practice-test/:id GET]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Autosave the current module's answer drafts.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await requireUid(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    await savePracticeDraft(uid, id, body?.answers ?? {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/practice-test/:id PATCH]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

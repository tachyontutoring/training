import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server-auth";
import { registerTutor } from "@/lib/tutor-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const accessCode = typeof body?.accessCode === "string" ? body.accessCode : "";
    const profile = await registerTutor(user, accessCode);
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    // Bad/missing access code is a client error.
    const msg = err instanceof Error ? err.message : "Server error";
    const status = /code/i.test(msg) ? 400 : 500;
    if (status === 500) console.error("[api/tutor/register]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}

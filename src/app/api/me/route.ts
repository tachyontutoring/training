import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server-auth";
import { ensureProfile } from "@/lib/tutor-service";

export const runtime = "nodejs";

// Returns the caller's profile, creating a student profile on first login.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const profile = await ensureProfile(user);
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/me]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { listAssignmentsForStudent } from "@/lib/tutor-service";

export const runtime = "nodejs";

// The signed-in student's own assignments.
export async function GET(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const assignments = await listAssignmentsForStudent(uid);
    return NextResponse.json({ assignments });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/assignments]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

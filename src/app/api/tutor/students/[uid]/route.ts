import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import { getStudentDetail } from "@/lib/tutor-service";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const tutorId = await requireTutor(req);
    const { uid } = await params;
    const detail = await getStudentDetail(tutorId, uid);
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

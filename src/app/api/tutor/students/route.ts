import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import { listStudents, addStudentByEmail } from "@/lib/tutor-service";

export const runtime = "nodejs";

function fail(err: unknown, tag: string) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  // Domain errors (e.g. "No account found…") are client-facing 400s.
  const msg = err instanceof Error ? err.message : "Server error";
  console.error(tag, err);
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const tutorId = await requireTutor(req);
    const students = await listStudents(tutorId);
    return NextResponse.json({ students });
  } catch (err) {
    return fail(err, "[api/tutor/students GET]");
  }
}

export async function POST(req: NextRequest) {
  try {
    const tutorId = await requireTutor(req);
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email : "";
    const name = typeof body?.name === "string" ? body.name : undefined;
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const student = await addStudentByEmail(tutorId, email, name);
    return NextResponse.json({ student });
  } catch (err) {
    return fail(err, "[api/tutor/students POST]");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import {
  getAssignmentMistakes,
  getPracticeTestMistakes,
} from "@/lib/tutor-service";

export const runtime = "nodejs";

// Wrong (or unanswered) questions a student got on a specific assignment or
// practice test. Query: kind=assignment|practice & id=<sourceId>.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const tutorId = await requireTutor(req);
    const { uid } = await params;
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    const id = sp.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const result =
      kind === "practice"
        ? await getPracticeTestMistakes(tutorId, uid, id)
        : await getAssignmentMistakes(tutorId, uid, id);
    return NextResponse.json(result);
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

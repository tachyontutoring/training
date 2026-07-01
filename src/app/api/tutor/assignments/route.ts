import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import { createAssignment } from "@/lib/tutor-service";
import type { AssignmentCriteria, Section } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const tutorId = await requireTutor(req);
    const body = await req.json().catch(() => ({}));
    const { studentId, title, criteria } = body ?? {};

    if (typeof studentId !== "string" || !criteria) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const sections = (
      Array.isArray(criteria.sections)
        ? criteria.sections.filter((s: unknown) => s === "reading" || s === "math")
        : []
    ) as Section[];
    const skills = Array.isArray(criteria.skills)
      ? criteria.skills.filter((s: unknown) => typeof s === "string")
      : [];
    const subSkills = Array.isArray(criteria.subSkills)
      ? criteria.subSkills.filter((s: unknown) => typeof s === "string")
      : [];
    const difficulties = Array.isArray(criteria.difficulties)
      ? criteria.difficulties
          .map((d: unknown) => Number(d))
          .filter((d: number) => Number.isFinite(d))
      : [];
    const count = Math.max(1, Math.min(50, Number(criteria.count) || 10));

    const clean: AssignmentCriteria = { sections, skills, subSkills, difficulties, count };
    const explicitQuestionIds = Array.isArray(body?.questionIds)
      ? body.questionIds.filter((q: unknown) => typeof q === "string")
      : undefined;
    const assignment = await createAssignment(
      tutorId,
      studentId,
      typeof title === "string" ? title : "",
      clean,
      explicitQuestionIds,
    );
    return NextResponse.json({ assignment });
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

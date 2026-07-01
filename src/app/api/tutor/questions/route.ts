import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import { searchQuestions } from "@/lib/question-bank";
import { getUsedQuestionIds } from "@/lib/tutor-service";
import type { Section } from "@/lib/types";

export const runtime = "nodejs";

// Browse the bank for the "pick specific questions" flow. Query params:
//   section, skill, subSkill (comma-separated), difficulty (comma-separated ints),
//   studentId (to hide questions that student has already seen), limit.
export async function GET(req: NextRequest) {
  try {
    await requireTutor(req);
    const sp = req.nextUrl.searchParams;
    const list = (k: string) =>
      (sp.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const sections = list("section").filter((s): s is Section => s === "reading" || s === "math");
    const skills = list("skill");
    const subSkills = list("subSkill");
    const difficulties = list("difficulty").map(Number).filter((n) => Number.isFinite(n));
    const studentId = sp.get("studentId") ?? "";
    const limit = Number(sp.get("limit")) || 50;

    const exclude = studentId ? await getUsedQuestionIds(studentId) : [];
    const result = await searchQuestions({
      sections,
      skills,
      subSkills,
      difficulties,
      exclude,
      limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[api/tutor/questions]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireTutor, AuthError, ForbiddenError } from "@/lib/server-auth";
import { bankFacets } from "@/lib/question-bank";

export const runtime = "nodejs";

// Distinct skills + difficulties in the bank, for the assignment builder.
export async function GET(req: NextRequest) {
  try {
    await requireTutor(req);
    const facets = await bankFacets();
    return NextResponse.json(facets);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[api/tutor/facets]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

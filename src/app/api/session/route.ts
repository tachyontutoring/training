import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { createSession, createAssignmentSession } from "@/lib/session-service";
import type { TestType } from "@/lib/types";

export const runtime = "nodejs";

const VALID: TestType[] = ["full", "reading", "math"];

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const body = await req.json().catch(() => ({}));

    // Tutor-assigned practice set takes precedence over a free-practice type.
    if (typeof body?.assignmentId === "string") {
      const result = await createAssignmentSession(uid, body.assignmentId);
      return NextResponse.json(result);
    }

    const type = body?.type as TestType;
    if (!VALID.includes(type)) {
      return NextResponse.json({ error: "Invalid test type" }, { status: 400 });
    }
    const result = await createSession(uid, type);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/session]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUid, AuthError } from "@/lib/server-auth";
import { adminDb } from "@/lib/firebase/admin";
import { emptyProgress, type ProgressStats } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const doc = await adminDb.doc(`users/${uid}`).get();
    const progress = (doc.data()?.progress as ProgressStats) ?? emptyProgress();
    return NextResponse.json({ progress });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[api/progress]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

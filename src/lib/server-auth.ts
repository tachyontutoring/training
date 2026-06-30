// Helper to authenticate API route requests via the Firebase ID token that
// the browser sends in the `Authorization: Bearer <token>` header.
import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserProfile } from "@/lib/types";

export class AuthError extends Error {}
// Thrown when the caller is authenticated but lacks the required role.
export class ForbiddenError extends Error {}

export interface AuthedUser {
  uid: string;
  email: string;
  name: string;
}

export async function requireUser(req: NextRequest): Promise<AuthedUser> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new AuthError("Missing Authorization bearer token");

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      name: (decoded.name as string) ?? decoded.email?.split("@")[0] ?? "",
    };
  } catch {
    throw new AuthError("Invalid or expired token");
  }
}

export async function requireUid(req: NextRequest): Promise<string> {
  return (await requireUser(req)).uid;
}

export async function getProfile(uid: string): Promise<UserProfile | null> {
  const snap = await adminDb.doc(`users/${uid}`).get();
  const data = snap.data();
  if (!data || !data.role) return null;
  return {
    uid,
    email: data.email ?? "",
    displayName: data.displayName ?? "",
    role: data.role,
    tutorId: data.tutorId ?? null,
    createdAt: data.createdAt ?? 0,
  };
}

// Verify the caller is a tutor; returns their uid. Throws ForbiddenError
// otherwise so routes can map it to a 403.
export async function requireTutor(req: NextRequest): Promise<string> {
  const uid = await requireUid(req);
  const profile = await getProfile(uid);
  if (!profile || profile.role !== "tutor") {
    throw new ForbiddenError("Tutor access required");
  }
  return uid;
}

// Firebase Admin SDK — server-only. Bypasses Firestore security rules.
import {
  initializeApp,
  getApps,
  getApp,
  cert,
  type App,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function buildApp(): App {
  if (getApps().length) return getApp();

  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "athens-6174e";

  // When emulators are configured, the Admin SDK auto-detects
  // FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST and no real
  // credentials are required.
  const usingEmulator =
    !!process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1";

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return initializeApp({ credential: cert(json), projectId: json.project_id });
  }

  if (usingEmulator) {
    return initializeApp({ projectId });
  }

  throw new Error(
    "Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT_B64 " +
      "or run against the emulator (NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1).",
  );
}

const app = buildApp();
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

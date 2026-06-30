// Runs once when the Next.js server boots. We warm the question-bank cache so
// the first student request doesn't pay the Firestore load.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureLoaded } = await import("@/lib/question-bank");
      await ensureLoaded();
    } catch (err) {
      // Non-fatal: the bank will lazy-load on first request instead.
      console.error("[instrumentation] question-bank warmup failed:", err);
    }
  }
}

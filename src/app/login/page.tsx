"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/PasswordInput";

export default function LoginPage() {
  const { signIn, authedFetch } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
      // Route by role: tutors land on their console, students on the dashboard.
      const me = await authedFetch("/api/me").then((r) => r.json());
      router.push(me?.profile?.role === "tutor" ? "/tutor" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col justify-center overflow-hidden px-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 grid-paper" />
      <div className="relative mx-auto w-full max-w-md">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-600" />
        <span className="mono-label">Tachyon</span>
      </div>
      <h1 className="font-display text-display-md font-medium text-ink">Welcome back</h1>
      <p className="mb-8 mt-2 text-ink-muted">Log in to continue your practice.</p>
      <form onSubmit={onSubmit} className="card space-y-5">
        <div>
          <label className="mono-label mb-1.5 block">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Password</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="text-accent-700 underline underline-offset-2">
          Create an account
        </Link>
      </p>
      </div>
    </main>
  );
}

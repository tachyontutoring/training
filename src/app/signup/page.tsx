"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { PasswordInput } from "@/components/PasswordInput";

export default function SignupPage() {
  const { signUp, authedFetch } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await signUp(name, email, password);
      await authedFetch("/api/me").catch(() => {}); // create the student profile
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign up");
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
      <h1 className="font-display text-display-md font-medium text-ink">Create your account</h1>
      <p className="mb-8 mt-2 text-ink-muted">Start practicing in under a minute.</p>
      <form onSubmit={onSubmit} className="card space-y-5">
        <div>
          <label className="mono-label mb-1.5 block">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
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
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Confirm password</label>
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Sign up"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-700 underline underline-offset-2">
          Log in
        </Link>
      </p>
      </div>
    </main>
  );
}

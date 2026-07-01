"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function TutorSignupPage() {
  const { signUp, signIn, authedFetch } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError("Emails don't match.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      // Create the auth account (or sign in if it already exists), then claim
      // the tutor role with the access code.
      try {
        await signUp(name, email, password);
      } catch (err) {
        if (err instanceof Error && /email-already-in-use/.test(err.message)) {
          await signIn(email, password);
        } else {
          throw err;
        }
      }
      const res = await authedFetch("/api/tutor/register", {
        method: "POST",
        body: JSON.stringify({ accessCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not register as tutor");
      router.push("/tutor");
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
        <span className="mono-label">Tachyon · Tutor</span>
      </div>
      <h1 className="font-display text-display-md font-medium text-ink">Tutor sign up</h1>
      <p className="mb-8 mt-2 text-ink-muted">
        Create a tutor account to manage students and assign practice.
      </p>
      <form onSubmit={onSubmit} className="card space-y-5">
        <div>
          <label className="mono-label mb-1.5 block">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Confirm email</label>
          <input className="input" type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} onPaste={(e) => e.preventDefault()} required />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Confirm password</label>
          <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required />
        </div>
        <div>
          <label className="mono-label mb-1.5 block">Tutor access code</label>
          <input
            className="input"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="Provided by your administrator"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create tutor account"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-muted">
        Already a tutor?{" "}
        <Link href="/login" className="text-accent-700 underline underline-offset-2">
          Log in
        </Link>
      </p>
      </div>
    </main>
  );
}

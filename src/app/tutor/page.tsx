"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireTutor } from "@/lib/use-profile";
import type { ProgressStats } from "@/lib/client-types";

interface RosterEntry {
  uid: string;
  email: string;
  displayName: string;
  progress: ProgressStats;
  assignmentsTotal: number;
  assignmentsCompleted: number;
}

export default function TutorDashboard() {
  const { profile, loading } = useRequireTutor();
  const { authedFetch, logout } = useAuth();
  const router = useRouter();

  const [students, setStudents] = useState<RosterEntry[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRoster = useCallback(() => {
    authedFetch("/api/tutor/students")
      .then((r) => r.json())
      .then((d) => setStudents(d.students ?? []))
      .catch(() => {});
  }, [authedFetch]);

  useEffect(() => {
    if (profile?.role === "tutor") loadRoster();
  }, [profile, loadRoster]);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await authedFetch("/api/tutor/students", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add student");
      setNotice(`Added ${data.student.displayName}.`);
      setEmail("");
      loadRoster();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add student");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-faint">
        Loading…
      </main>
    );
  }

  const pct = (a: number, c: number) => (a ? Math.round((c / a) * 100) : 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="mono-label-accent">
            School of Athens · Tutor
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight">{profile.displayName}&rsquo;s students</h1>
        </div>
        <button
          onClick={() => logout().then(() => router.push("/"))}
          className="text-sm text-ink-muted underline"
        >
          Log out
        </button>
      </header>

      <section className="card mb-8">
        <h2 className="mb-3 font-display text-lg font-medium">Add a student</h2>
        <form onSubmit={addStudent} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="mono-label mb-1.5 block">Student email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="student@example.com"
              required
            />
          </div>
          <button className="btn-primary" disabled={busy}>
            {busy ? "Adding…" : "Add student"}
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-faint">
          The student must already have an account.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}
      </section>

      <h2 className="mb-3 font-display text-xl font-medium">Roster ({students.length})</h2>
      {students.length === 0 ? (
        <div className="card text-ink-muted">
          No students yet. Add one by email above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-paper-soft/50">
          <table className="w-full text-left text-sm">
            <thead className="bg-paper-deep font-mono text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Answered</th>
                <th className="px-4 py-3">Accuracy</th>
                <th className="px-4 py-3">Assignments</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.uid} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.displayName}</div>
                    <div className="text-xs text-ink-faint">{s.email}</div>
                  </td>
                  <td className="px-4 py-3">{s.progress.totalAnswered}</td>
                  <td className="px-4 py-3">
                    {pct(s.progress.totalAnswered, s.progress.totalCorrect)}%
                  </td>
                  <td className="px-4 py-3">
                    {s.assignmentsCompleted}/{s.assignmentsTotal} done
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/tutor/students/${s.uid}`}
                      className="text-accent-700 underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

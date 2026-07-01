"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import { emptyProgress, type ProgressStats } from "@/lib/types";
import type { Assignment } from "@/lib/client-types";

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const { authedFetch, logout } = useAuth();
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressStats>(emptyProgress());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [startingTest, setStartingTest] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    authedFetch("/api/progress")
      .then((r) => r.json())
      .then((d) => d.progress && setProgress(d.progress))
      .catch(() => {});
    authedFetch("/api/assignments")
      .then((r) => r.json())
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
  }, [user, authedFetch]);

  async function startAssignment(a: Assignment) {
    setStarting(a.id);
    setError("");
    try {
      const res = await authedFetch("/api/session", {
        method: "POST",
        body: JSON.stringify({ assignmentId: a.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start assignment");
      router.push(`/test/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start assignment");
      setStarting(null);
    }
  }

  async function startPracticeTest() {
    setStartingTest(true);
    setError("");
    try {
      const res = await authedFetch("/api/practice-test", {
        method: "POST",
        body: JSON.stringify({ blueprintId: "sat-practice-1" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start practice test");
      router.push(`/practice/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start practice test");
      setStartingTest(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-faint">
        Loading…
      </main>
    );
  }

  const pct = (a: number, c: number) => (a ? Math.round((c / a) * 100) : 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="mono-label-accent">
            School of Athens
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight">
            Welcome, {user.displayName || user.email?.split("@")[0]}
          </h1>
        </div>
        <button
          onClick={() => logout().then(() => router.push("/"))}
          className="text-sm text-ink-muted underline"
        >
          Log out
        </button>
      </header>

      <section className="mb-10 max-w-xs">
        <Stat label="Questions answered" value={progress.totalAnswered} />
      </section>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="card mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-xl font-medium">Full practice test</h2>
          <p className="mt-1 text-sm text-ink-muted">
            A timed, adaptive digital-SAT simulation — Reading &amp; Writing and Math, two modules each.
          </p>
        </div>
        <button className="btn-primary shrink-0" disabled={startingTest} onClick={startPracticeTest}>
          {startingTest ? "Starting…" : "Take a practice test"}
        </button>
      </div>

      <h2 className="mb-4 font-display text-xl font-medium">Assigned by your tutor</h2>
      {assignments.length === 0 ? (
        <p className="card text-sm text-ink-muted">
          No practice assigned yet. Your tutor will add sets here — check back after your next
          session.
        </p>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const done = a.status === "completed";
            const inProgress = !done && a.answered > 0;
            return (
              <div
                key={a.id}
                className="card flex items-center justify-between"
              >
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-ink-faint">
                    {a.questionIds.length} questions
                    {done
                      ? ` · scored ${pct(a.answered, a.correct)}%`
                      : inProgress
                        ? ` · ${a.answered}/${a.questionIds.length} done`
                        : a.criteria.skills.length
                          ? ` · ${a.criteria.skills.join(", ")}`
                          : ""}
                  </div>
                </div>
                {done ? (
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                      Completed
                    </span>
                    {a.sessionId && (
                      <button
                        className="btn-secondary"
                        onClick={() => router.push(`/test/${a.sessionId}`)}
                      >
                        Review
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={starting !== null}
                    onClick={() => startAssignment(a)}
                  >
                    {starting === a.id
                      ? inProgress
                        ? "Resuming…"
                        : "Starting…"
                      : inProgress
                        ? "Resume"
                        : "Start"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card text-center">
      <div className="font-display text-3xl font-medium tracking-tight">{value}</div>
      <div className="mt-1 mono-label">
        {label}
      </div>
    </div>
  );
}

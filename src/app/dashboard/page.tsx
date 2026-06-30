"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import { emptyProgress, type ProgressStats, type TestType } from "@/lib/types";
import type { Assignment } from "@/lib/client-types";

type TestCard = {
  type: TestType;
  title: string;
  blurb: string;
  cls: string;
  available: boolean;
};

const TESTS: TestCard[] = [
  {
    type: "reading",
    title: "Reading & Writing",
    blurb: "Adaptive drills across all 10 RW skills — evidence, inferences, words in context, transitions, and more.",
    cls: "btn-primary",
    available: true,
  },
  {
    type: "math",
    title: "Math",
    blurb: "Coming soon — the Math bank is still being prepared.",
    cls: "btn-primary",
    available: false,
  },
  {
    type: "full",
    title: "Full Practice Test",
    blurb: "Coming soon — combines Reading & Writing with Math.",
    cls: "btn-primary",
    available: false,
  },
];

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const { authedFetch, logout } = useAuth();
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressStats>(emptyProgress());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
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
      sessionStorage.setItem(`session:${data.session.id}`, JSON.stringify(data));
      router.push(`/test/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start assignment");
      setStarting(null);
    }
  }

  async function startTest(type: TestType) {
    setStarting(type);
    setError("");
    try {
      const res = await authedFetch("/api/session", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start test");
      // hand the first question to the test page without an extra round-trip
      sessionStorage.setItem(`session:${data.session.id}`, JSON.stringify(data));
      router.push(`/test/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start test");
      setStarting(null);
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

      <section className="mb-10 grid grid-cols-3 gap-4">
        <Stat label="Questions answered" value={progress.totalAnswered} />
        <Stat
          label="Overall accuracy"
          value={`${pct(progress.totalAnswered, progress.totalCorrect)}%`}
        />
        <Stat
          label="Reading vs Math"
          value={`${pct(
            progress.bySection.reading.answered,
            progress.bySection.reading.correct,
          )}% / ${pct(
            progress.bySection.math.answered,
            progress.bySection.math.correct,
          )}%`}
        />
      </section>

      {assignments.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 font-display text-xl font-medium">Assigned by your tutor</h2>
          <div className="space-y-3">
            {assignments.map((a) => {
              const done = a.status === "completed";
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
                        : a.criteria.skills.length
                          ? ` · ${a.criteria.skills.join(", ")}`
                          : ""}
                    </div>
                  </div>
                  {done ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                      Completed
                    </span>
                  ) : (
                    <button
                      className="btn-primary"
                      disabled={starting !== null}
                      onClick={() => startAssignment(a)}
                    >
                      {starting === a.id ? "Starting…" : "Start"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="mb-4 font-display text-xl font-medium">Choose your practice</h2>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        {TESTS.map((t) => (
          <div
            key={t.type}
            className={`card flex flex-col ${t.available ? "" : "opacity-60"}`}
          >
            <h3 className="mb-1 font-display text-lg font-medium">{t.title}</h3>
            <p className="mb-4 flex-1 text-sm text-ink-muted">{t.blurb}</p>
            <button
              className={`${t.cls} w-full`}
              disabled={!t.available || starting !== null}
              onClick={() => startTest(t.type)}
            >
              {!t.available
                ? "Coming soon"
                : starting === t.type
                  ? "Starting…"
                  : "Begin"}
            </button>
          </div>
        ))}
      </div>
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

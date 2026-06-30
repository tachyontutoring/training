"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireTutor } from "@/lib/use-profile";
import type { Assignment, ProgressStats, UserProfile } from "@/lib/client-types";

const DIFF_LABEL: Record<number, string> = { 2: "Easy", 3: "Medium", 4: "Hard" };

interface Detail {
  profile: UserProfile;
  progress: ProgressStats;
  assignments: Assignment[];
}

export default function StudentDetailPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = use(params);
  const { profile: me, loading } = useRequireTutor();
  const { authedFetch } = useAuth();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [facets, setFacets] = useState<{ skills: string[]; difficulties: number[] }>({
    skills: [],
    difficulties: [],
  });
  const [loadError, setLoadError] = useState("");

  // assignment form state
  const [title, setTitle] = useState("");
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const [diffs, setDiffs] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    authedFetch(`/api/tutor/students/${uid}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load student");
        setDetail(d);
      })
      .catch((e) => setLoadError(e.message));
  }, [authedFetch, uid]);

  useEffect(() => {
    if (me?.role !== "tutor") return;
    load();
    authedFetch("/api/tutor/facets")
      .then((r) => r.json())
      .then((d) => setFacets({ skills: d.skills ?? [], difficulties: d.difficulties ?? [] }))
      .catch(() => {});
  }, [me, load, authedFetch]);

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await authedFetch("/api/tutor/assignments", {
        method: "POST",
        body: JSON.stringify({
          studentId: uid,
          title,
          criteria: {
            skills: [...skills],
            difficulties: [...diffs],
            count,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign");
      setNotice(`Assigned “${data.assignment.title}” (${data.assignment.questionIds.length} questions).`);
      setTitle("");
      setSkills(new Set());
      setDiffs(new Set());
      setCount(10);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not assign");
    } finally {
      setBusy(false);
    }
  }

  if (loading || (me?.role === "tutor" && !detail && !loadError)) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-faint">
        Loading…
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/tutor" className="text-accent-700 underline">
          ← Back
        </Link>
        <p className="mt-4 text-red-600">{loadError}</p>
      </main>
    );
  }
  if (!detail) return null;

  const pct = (a: number, c: number) => (a ? Math.round((c / a) * 100) : 0);
  const skillRows = Object.entries(detail.progress.bySkill).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/tutor" className="text-sm text-accent-700 underline">
        ← Back to roster
      </Link>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-tight">{detail.profile.displayName}</h1>
      <p className="mb-8 text-ink-muted">{detail.profile.email}</p>

      {/* Progress overview */}
      <section className="mb-8 grid grid-cols-3 gap-4">
        <Stat label="Questions answered" value={detail.progress.totalAnswered} />
        <Stat
          label="Overall accuracy"
          value={`${pct(detail.progress.totalAnswered, detail.progress.totalCorrect)}%`}
        />
        <Stat label="Skills practiced" value={skillRows.length} />
      </section>

      {/* Per-skill breakdown */}
      <section className="card mb-8">
        <h2 className="mb-3 font-display text-lg font-medium">Skill breakdown</h2>
        {skillRows.length === 0 ? (
          <p className="text-sm text-ink-faint">No practice yet.</p>
        ) : (
          <div className="space-y-2">
            {skillRows.map(([skill, v]) => (
              <div key={skill} className="flex items-center gap-3">
                <div className="w-56 shrink-0 text-sm">{skill}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-deep">
                  <div
                    className="h-full bg-accent-600"
                    style={{ width: `${pct(v.answered, v.correct)}%` }}
                  />
                </div>
                <div className="w-20 text-right text-xs text-ink-muted">
                  {pct(v.answered, v.correct)}% · {v.answered}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Assign a practice set */}
      <section className="card mb-8">
        <h2 className="mb-3 font-display text-lg font-medium">Assign a practice set</h2>
        <form onSubmit={assign} className="space-y-4">
          <div>
            <label className="mono-label mb-1.5 block">Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Transitions warm-up"
            />
          </div>

          <div>
            <label className="mono-label mb-1.5 block">
              Skills <span className="text-ink-faint">(none = any)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {facets.skills.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggle(skills, s, setSkills)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    skills.has(s)
                      ? "border-accent-600 bg-accent-50 text-accent-700"
                      : "border-line text-ink-soft"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="mono-label mb-1.5 block">
                Difficulty <span className="text-ink-faint">(none = any)</span>
              </label>
              <div className="flex gap-2">
                {facets.difficulties.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => toggle(diffs, d, setDiffs)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      diffs.has(d)
                        ? "border-accent-600 bg-accent-50 text-accent-700"
                        : "border-line text-ink-soft"
                    }`}
                  >
                    {DIFF_LABEL[d] ?? d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mono-label mb-1.5 block"># Questions</label>
              <input
                className="input w-24"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {notice && <p className="text-sm text-green-700">{notice}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? "Assigning…" : "Assign practice set"}
          </button>
        </form>
      </section>

      {/* Assignment history */}
      <section className="card">
        <h2 className="mb-3 font-display text-lg font-medium">
          Assignments ({detail.assignments.length})
        </h2>
        {detail.assignments.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing assigned yet.</p>
        ) : (
          <div className="space-y-2">
            {detail.assignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-line px-4 py-3"
              >
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-ink-faint">
                    {a.questionIds.length} questions
                    {a.criteria.skills.length
                      ? ` · ${a.criteria.skills.join(", ")}`
                      : " · any skill"}
                  </div>
                </div>
                <div className="text-right text-sm">
                  {a.status === "completed" ? (
                    <span className="font-medium text-green-700">
                      {pct(a.answered, a.correct)}% ({a.correct}/{a.answered})
                    </span>
                  ) : (
                    <span className="text-ink-faint">Not started</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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

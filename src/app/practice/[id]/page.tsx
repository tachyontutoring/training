"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import { MathText } from "@/components/MathText";
import { predictedScore } from "@/lib/scoring";
import type { AnswerKey, PublicQuestion } from "@/lib/client-types";

type Meta = {
  id: string;
  title: string;
  section: string;
  timeMs: number;
  status: string;
  tier: "easy" | "hard" | null;
  answered: number;
  correct: number;
  total: number;
};
type Current = {
  index: number;
  id: string;
  title: string;
  section: string;
  timeMs: number;
  tier: "easy" | "hard" | null;
  questions: PublicQuestion[];
  answers: Record<string, AnswerKey>;
};
type ReviewItem = PublicQuestion & {
  yourAnswer: AnswerKey | null;
  correctAnswer: AnswerKey;
  isCorrect: boolean;
  explanation: string;
};
type ReviewModule = {
  id: string;
  title: string;
  section: string;
  answered: number;
  correct: number;
  total: number;
  items: ReviewItem[];
};
type View = {
  id: string;
  title: string;
  status: "active" | "completed";
  currentModuleIndex: number;
  totalAnswered: number;
  totalCorrect: number;
  modules: Meta[];
  current: Current | null;
  results: ReviewModule[] | null;
};

const SECTION_LABEL: Record<string, string> = {
  reading: "Reading and Writing",
  math: "Math",
};

function fmt(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function hasStimulus(q: PublicQuestion) {
  return !!(q.stimulusImage || q.stimulusTableHtml || (q.passage && q.passage.trim()));
}
function Q({ text, math }: { text: string; math: boolean }) {
  return math ? <MathText text={text} /> : <>{text}</>;
}

export default function PracticeTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading } = useRequireAuth();
  const { authedFetch } = useAuth();

  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [moduleStarted, setModuleStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // module runner state
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerKey>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [eliminated, setEliminated] = useState<Record<string, AnswerKey[]>>({});
  const [crossOut, setCrossOut] = useState(false);
  const [showNav, setShowNav] = useState(false);

  // countdown
  const deadlineRef = useRef<number>(0);
  const [tick, setTick] = useState(0);
  const enteredAt = useRef<number>(0);
  const times = useRef<Record<string, number>>({});
  const submittedRef = useRef(false);

  // review nav
  const [reviewIdx, setReviewIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/practice-test/${id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load test");
      setView(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load test");
    }
  }, [authedFetch, id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const cur = view?.current ?? null;

  // When a new module becomes current, reset the runner (show interstitial).
  useEffect(() => {
    if (!cur) return;
    setIdx(0);
    setAnswers(cur.answers ?? {});
    setMarked(new Set());
    setEliminated({});
    setCrossOut(false);
    setModuleStarted(false);
    times.current = {};
    submittedRef.current = false;
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const beginModule = () => {
    if (!cur) return;
    deadlineRef.current = Date.now() + cur.timeMs;
    enteredAt.current = Date.now();
    submittedRef.current = false;
    setModuleStarted(true);
  };

  // accrue per-question time
  useEffect(() => {
    if (!moduleStarted || !cur) return;
    const qid = cur.questions[idx]?.id;
    enteredAt.current = Date.now();
    return () => {
      if (qid) times.current[qid] = (times.current[qid] ?? 0) + (Date.now() - enteredAt.current);
    };
  }, [idx, moduleStarted, cur]);

  // autosave draft
  useEffect(() => {
    if (!moduleStarted) return;
    const t = setTimeout(() => {
      authedFetch(`/api/practice-test/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ answers }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [answers, moduleStarted, id, authedFetch]);

  const submitModule = useCallback(async () => {
    if (!cur || submittedRef.current) return;
    submittedRef.current = true;
    const q = cur.questions[idx]?.id;
    if (q) {
      times.current[q] = (times.current[q] ?? 0) + (Date.now() - enteredAt.current);
      enteredAt.current = Date.now();
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await authedFetch(`/api/practice-test/${id}/submit-module`, {
        method: "POST",
        body: JSON.stringify({ answers, times: times.current }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not submit");
      setModuleStarted(false);
      setReviewIdx(0);
      setView(d);
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }, [answers, cur, idx, id, authedFetch]);

  // countdown tick + auto-submit at zero
  useEffect(() => {
    if (!moduleStarted) return;
    const t = setInterval(() => {
      setTick(Date.now());
      if (Date.now() >= deadlineRef.current && !submittedRef.current) submitModule();
    }, 500);
    return () => clearInterval(t);
  }, [moduleStarted, submitModule]);

  const answeredCount = useMemo(
    () => (cur ? cur.questions.filter((q) => answers[q.id]).length : 0),
    [cur, answers],
  );

  if (loading || (!view && !error)) return <Centered>Loading…</Centered>;
  if (error) {
    return (
      <Centered>
        <p className="mb-4 text-rose-600">{error}</p>
        <Link href="/dashboard" className="rounded-md bg-slate-900 px-4 py-2 text-white">
          Back to dashboard
        </Link>
      </Centered>
    );
  }
  if (!view) return <Centered>Loading…</Centered>;

  // ---------- Final report ----------
  if (view.status === "completed" && view.results) {
    const flat = view.results.flatMap((m) =>
      m.items.map((it) => ({ ...it, moduleTitle: m.title })),
    );
    const pct = view.totalAnswered
      ? Math.round((view.totalCorrect / view.totalAnswered) * 100)
      : 0;
    const bySection = (sec: string) => {
      const mods = view.results!.filter((m) => m.section === sec);
      const a = mods.reduce((s, m) => s + m.answered, 0);
      const c = mods.reduce((s, m) => s + m.correct, 0);
      return { a, c, pct: a ? Math.round((c / a) * 100) : 0 };
    };
    const rw = bySection("reading");
    const math = bySection("math");
    const score = predictedScore(rw.c, rw.a, math.c, math.a);
    const r = flat[reviewIdx];
    const rq = r;
    return (
      <div className="flex min-h-screen flex-col bg-white font-sans text-slate-900">
        <header className="border-b border-slate-200 px-6 py-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">
                {view.title} · Complete
              </p>
              <Link
                href="/dashboard"
                className="shrink-0 rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
              >
                Done
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-x-12 gap-y-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Predicted score
                </div>
                <div className="text-5xl font-bold leading-none tabular-nums">{score.total}</div>
                <div className="mt-1.5 text-xs text-slate-500">
                  out of 1600 · {pct}% correct ({view.totalCorrect}/{view.totalAnswered})
                </div>
              </div>
              <ScoreStat
                label="Reading & Writing"
                score={score.rw}
                detail={`${rw.c}/${rw.a} correct · ${rw.pct}%`}
              />
              <ScoreStat
                label="Math"
                score={score.math}
                detail={`${math.c}/${math.a} correct · ${math.pct}%`}
              />
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Estimated from accuracy — an approximation, not an official College Board score.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {view.modules.map((m) => {
                const short = m.title
                  .replace("Reading & Writing — Module ", "R&W M")
                  .replace("Math — Module ", "Math M");
                return (
                  <div
                    key={m.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="text-[11px] font-medium text-slate-500">
                      {short}
                      {m.tier ? ` · ${m.tier}` : ""}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-800">
                      {m.correct}/{m.total}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        {/* review grid */}
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5">
            {flat.map((it, i) => (
              <button
                key={i}
                onClick={() => setReviewIdx(i)}
                className={`h-7 w-7 rounded text-xs font-semibold ${
                  i === reviewIdx ? "ring-2 ring-slate-900 ring-offset-1" : ""
                } ${
                  it.yourAnswer == null
                    ? "bg-slate-200 text-slate-600"
                    : it.isCorrect
                      ? "bg-green-100 text-green-700"
                      : "bg-rose-100 text-rose-700"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {rq && (
          <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {rq.moduleTitle}
            </div>
            {hasStimulus(rq) && (
              <div className="mb-4 space-y-3 border-b border-slate-200 pb-4">
                {rq.stimulusImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={rq.stimulusImage}
                    alt="Figure"
                    className="mx-auto max-h-[40vh] w-auto rounded border border-slate-200"
                  />
                )}
                {rq.stimulusTableHtml && (
                  <div className="stimulus-table" dangerouslySetInnerHTML={{ __html: rq.stimulusTableHtml }} />
                )}
                {rq.passage && rq.passage.trim() && (
                  <div className="whitespace-pre-line text-[16px] leading-relaxed text-slate-800">
                    {rq.passage}
                  </div>
                )}
              </div>
            )}
            <p className="mb-4 text-[17px] font-medium leading-relaxed">
              <Q text={rq.prompt} math={rq.section === "math"} />
            </p>
            <div className="space-y-2">
              {rq.choices.map((c) => {
                const key = c.key as AnswerKey;
                const isCorrect = rq.correctAnswer === key;
                const isYours = rq.yourAnswer === key;
                let cls = "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-[16px]";
                if (isCorrect) cls += " border-green-600 bg-green-50";
                else if (isYours) cls += " border-rose-500 bg-rose-50";
                else cls += " border-slate-200";
                return (
                  <div key={key} className={cls}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-400 text-sm font-semibold">
                      {key}
                    </span>
                    <span className="flex-1">
                      <Q text={c.text} math={rq.section === "math"} />
                    </span>
                    {isCorrect && <span className="text-xs font-semibold text-green-700">Correct</span>}
                    {isYours && !isCorrect && (
                      <span className="text-xs font-semibold text-rose-700">Your answer</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Explanation
              </p>
              <p className="text-sm leading-relaxed text-slate-700">
                <Q text={rq.explanation} math={rq.section === "math"} />
              </p>
            </div>
          </main>
        )}

        <footer className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            onClick={() => setReviewIdx((i) => Math.max(0, i - 1))}
            disabled={reviewIdx === 0}
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            ◀ Prev
          </button>
          <span className="text-sm font-medium text-slate-600">
            {reviewIdx + 1} / {flat.length}
          </span>
          <button
            onClick={() => setReviewIdx((i) => Math.min(flat.length - 1, i + 1))}
            disabled={reviewIdx >= flat.length - 1}
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Next ▶
          </button>
        </footer>
      </div>
    );
  }

  if (!cur) return <Centered>Loading…</Centered>;

  // ---------- Interstitial (before a module starts) ----------
  if (!moduleStarted) {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">
            {view.title} · Module {cur.index + 1} of {view.modules.length}
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold">{cur.title}</h1>
          {cur.tier && (
            <p className="mt-1 text-sm text-slate-500">
              Adaptive tier: <span className="font-medium capitalize">{cur.tier}</span>
            </p>
          )}
          <p className="mt-4 text-slate-600">
            {cur.questions.length} questions · {Math.round(cur.timeMs / 60000)} minutes
          </p>
          <p className="mt-1 text-xs text-slate-400">
            The timer starts when you begin and submits automatically at 0:00.
          </p>
          <button
            onClick={beginModule}
            className="mt-6 w-full rounded-md bg-accent-600 px-5 py-2.5 font-medium text-white hover:bg-accent-700"
          >
            Begin module
          </button>
          <Link href="/dashboard" className="mt-3 inline-block text-sm text-slate-500 underline">
            Save &amp; exit
          </Link>
        </div>
      </Centered>
    );
  }

  // ---------- Module runner ----------
  const q = cur.questions[idx];
  const isMath = q.section === "math";
  const timeLeft = deadlineRef.current - (tick || Date.now());
  const elim = new Set(eliminated[q.id] ?? []);
  const total = cur.questions.length;

  return (
    <div className="flex h-screen flex-col bg-white font-sans text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
        <div className="min-w-[160px]">
          <div className="text-[15px] font-bold">{SECTION_LABEL[q.section] ?? "Practice"}</div>
          <div className="text-[11px] text-slate-500">
            Module {cur.index + 1} of {view.modules.length}
          </div>
        </div>
        <div
          className={`flex items-center gap-1.5 text-xl font-semibold tabular-nums ${
            timeLeft < 60000 ? "text-rose-600" : ""
          }`}
        >
          <ClockIcon />
          <span>{fmt(timeLeft)}</span>
        </div>
        <div className="flex min-w-[160px] justify-end">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
            Save &amp; exit
          </Link>
        </div>
      </header>

      <main
        className={`grid flex-1 overflow-hidden ${
          hasStimulus(q) ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {hasStimulus(q) && (
          <section className="overflow-y-auto border-slate-200 px-6 py-6 md:border-r lg:px-10">
            <div className="mx-auto max-w-prose space-y-4">
              {q.stimulusImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={q.stimulusImage}
                  alt="Figure for this question"
                  className="mx-auto max-h-[55vh] w-auto rounded border border-slate-200"
                />
              )}
              {q.stimulusTableHtml && (
                <div className="stimulus-table" dangerouslySetInnerHTML={{ __html: q.stimulusTableHtml }} />
              )}
              {q.passage && q.passage.trim() && (
                <div className="whitespace-pre-line text-[17px] leading-relaxed text-slate-800">
                  {q.passage}
                </div>
              )}
            </div>
          </section>
        )}

        <section className="overflow-y-auto px-6 py-5 lg:px-10">
          <div className="mx-auto max-w-prose">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-900 text-sm font-bold text-white">
                  {idx + 1}
                </span>
                <button
                  onClick={() =>
                    setMarked((prev) => {
                      const n = new Set(prev);
                      if (n.has(q.id)) n.delete(q.id);
                      else n.add(q.id);
                      return n;
                    })
                  }
                  className={`flex items-center gap-1 text-sm ${
                    marked.has(q.id) ? "text-accent-600" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <BookmarkIcon filled={marked.has(q.id)} />
                  Mark for Review
                </button>
              </div>
              <button
                onClick={() => setCrossOut((v) => !v)}
                className={`rounded border px-2 py-1 text-xs font-semibold ${
                  crossOut
                    ? "border-accent-600 bg-accent-50 text-accent-600"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="line-through">ABC</span>
              </button>
            </div>

            <p className="mb-5 text-[17px] font-medium leading-relaxed">
              <Q text={q.prompt} math={isMath} />
            </p>

            <div className="space-y-3">
              {q.choices.map((c) => {
                const key = c.key as AnswerKey;
                const isSel = answers[q.id] === key;
                const isCrossed = elim.has(key);
                let box =
                  "relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-[16px] transition-colors";
                if (isSel) box += " border-accent-600 bg-accent-50";
                else box += " border-slate-300 hover:border-slate-400";
                return (
                  <div key={key} className="flex items-center gap-2">
                    <button
                      className={`${box} flex-1 ${isCrossed ? "opacity-40" : ""}`}
                      disabled={isCrossed && !isSel}
                      onClick={() =>
                        !isCrossed && setAnswers((prev) => ({ ...prev, [q.id]: key }))
                      }
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                          isSel
                            ? "border-accent-600 bg-accent-600 text-white"
                            : "border-slate-400 text-slate-700"
                        }`}
                      >
                        {key}
                      </span>
                      <span className={isCrossed ? "line-through" : ""}>
                        <Q text={c.text} math={isMath} />
                      </span>
                    </button>
                    {crossOut && (
                      <button
                        onClick={() =>
                          setEliminated((prev) => {
                            const s = new Set(prev[q.id] ?? []);
                            if (s.has(key)) s.delete(key);
                            else s.add(key);
                            return { ...prev, [q.id]: [...s] };
                          })
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                      >
                        <span className="line-through">{key}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {showNav && (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5">
            {cur.questions.map((qq, i) => {
              const isAns = !!answers[qq.id];
              const isMk = marked.has(qq.id);
              return (
                <button
                  key={qq.id}
                  onClick={() => {
                    setIdx(i);
                    setShowNav(false);
                  }}
                  className={`relative h-8 w-8 rounded text-xs font-semibold ${
                    i === idx ? "ring-2 ring-slate-900 ring-offset-1" : ""
                  } ${isAns ? "bg-accent-600 text-white" : "border border-slate-300 bg-white text-slate-600"}`}
                >
                  {i + 1}
                  {isMk && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="min-w-[110px] rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40"
        >
          ◀ Prev
        </button>
        <button
          onClick={() => setShowNav((v) => !v)}
          className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white"
        >
          Question {idx + 1} of {total} · {answeredCount} answered ▾
        </button>
        <div className="flex min-w-[110px] justify-end">
          {idx < total - 1 ? (
            <button
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              className="rounded-full bg-accent-600 px-6 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Next ▶
            </button>
          ) : (
            <button
              onClick={submitModule}
              disabled={submitting}
              className="rounded-full bg-accent-600 px-6 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Submit module"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function ScoreStat({
  label,
  score,
  detail,
}: {
  label: string;
  score: number;
  detail: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-2xl font-bold leading-tight tabular-nums text-slate-800">{score}</div>
      <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center font-sans">
      {children}
    </main>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}
function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

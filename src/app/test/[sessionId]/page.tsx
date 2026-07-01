"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import { MathText } from "@/components/MathText";
import { GridInInput, GridInReview } from "@/components/GridIn";
import type {
  AnswerKey,
  PublicQuestion,
  SessionDoc,
  SubmittedQuestionClient,
} from "@/lib/client-types";

type Phase = "loading" | "testing" | "review";

const SECTION_LABEL: Record<string, string> = {
  reading: "Reading and Writing",
  math: "Math",
};

function fmt(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function hasStimulus(q: PublicQuestion) {
  return !!(
    q.stimulusImage ||
    q.stimulusTableHtml ||
    (q.passage && q.passage.trim())
  );
}

export default function TestPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { user, loading } = useRequireAuth();
  const { authedFetch } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<SessionDoc | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [eliminated, setEliminated] = useState<Record<string, AnswerKey[]>>({});
  const [results, setResults] = useState<SubmittedQuestionClient[] | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // tools / chrome
  const [crossOut, setCrossOut] = useState(false);
  const [showTimer, setShowTimer] = useState(true);
  const [showNav, setShowNav] = useState(false);

  // timing
  const mountRef = useRef<number>(0);
  const [tick, setTick] = useState(0);
  const enteredAt = useRef<number>(0);
  const times = useRef<Record<string, number>>({});

  // ---- load full session state ----
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    authedFetch(`/api/session/${sessionId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load session");
        if (cancelled) return;
        setSession(d.session);
        setQuestions(d.questions ?? []);
        setAnswers(d.answers ?? {});
        setMarked(new Set<string>(d.marked ?? []));
        const start = Math.min(d.currentIndex ?? 0, Math.max(0, (d.questions?.length ?? 1) - 1));
        setIdx(start);
        if (d.session?.status === "completed") {
          // Re-grade idempotently to populate the review screen.
          const sr = await authedFetch(`/api/session/${sessionId}/submit`, {
            method: "POST",
            body: JSON.stringify({ answers: d.answers ?? {} }),
          }).then((x) => x.json());
          if (cancelled) return;
          setResults(sr.results ?? []);
          setSession(sr.session ?? d.session);
          setPhase("review");
        } else {
          mountRef.current = Date.now();
          enteredAt.current = Date.now();
          setPhase("testing");
        }
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [user, sessionId, authedFetch]);

  // running clock (display only)
  useEffect(() => {
    if (phase !== "testing") return;
    const i = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(i);
  }, [phase]);

  // accrue per-question time; commit when leaving a question or unmounting
  useEffect(() => {
    if (phase !== "testing") return;
    const qid = questions[idx]?.id;
    enteredAt.current = Date.now();
    return () => {
      if (qid) {
        times.current[qid] =
          (times.current[qid] ?? 0) + (Date.now() - enteredAt.current);
      }
    };
  }, [idx, phase, questions]);

  // autosave draft (debounced) while testing
  useEffect(() => {
    if (phase !== "testing") return;
    const t = setTimeout(() => {
      authedFetch(`/api/session/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          answers,
          marked: [...marked],
          currentIndex: idx,
        }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [answers, marked, idx, phase, sessionId, authedFetch]);

  const total = questions.length;
  const answeredCount = useMemo(
    () => questions.filter((q) => answers[q.id]).length,
    [questions, answers],
  );

  const goTo = useCallback(
    (i: number) => {
      setIdx(Math.max(0, Math.min(total - 1, i)));
      setShowNav(false);
    },
    [total],
  );

  function selectAnswer(qid: string, key: AnswerKey) {
    setAnswers((prev) => ({ ...prev, [qid]: key }));
  }
  function toggleMark(qid: string) {
    setMarked((prev) => {
      const n = new Set(prev);
      if (n.has(qid)) n.delete(qid);
      else n.add(qid);
      return n;
    });
  }
  function toggleEliminated(qid: string, key: AnswerKey) {
    setEliminated((prev) => {
      const cur = new Set(prev[qid] ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, [qid]: [...cur] };
    });
  }

  const submit = useCallback(async () => {
    const cur = questions[idx]?.id;
    if (cur) {
      times.current[cur] =
        (times.current[cur] ?? 0) + (Date.now() - enteredAt.current);
      enteredAt.current = Date.now();
    }
    const unanswered = total - questions.filter((q) => answers[q.id]).length;
    if (
      unanswered > 0 &&
      !window.confirm(
        `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await authedFetch(`/api/session/${sessionId}/submit`, {
        method: "POST",
        body: JSON.stringify({ answers, times: times.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit");
      setResults(data.results ?? []);
      setSession(data.session ?? session);
      setIdx(0);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  }, [answers, questions, idx, total, sessionId, authedFetch, session]);

  if (loading || phase === "loading") {
    return <Centered>Loading your test…</Centered>;
  }
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

  // ---------- Review screen ----------
  if (phase === "review" && results) {
    const correct = results.filter((r) => r.correct).length;
    const graded = results.filter((r) => r.yourAnswer != null).length;
    const pct = graded ? Math.round((correct / graded) * 100) : 0;
    const r = results[idx];
    const q = questions.find((x) => x.id === r?.questionId) ?? questions[idx];
    return (
      <div className="flex min-h-screen flex-col bg-white font-sans text-slate-900">
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">
                Practice · Complete
              </p>
              <p className="text-sm text-slate-600">
                {correct} of {graded} correct{" "}
                <span className="font-semibold text-slate-900">({pct}%)</span>
                {graded < total && (
                  <span className="text-slate-400"> · {total - graded} skipped</span>
                )}
              </p>
            </div>
            <Link
              href="/dashboard"
              className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Done
            </Link>
          </div>
        </header>

        {/* question nav grid */}
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5">
            {results.map((rr, i) => (
              <button
                key={rr.questionId}
                onClick={() => setIdx(i)}
                className={`h-7 w-7 rounded text-xs font-semibold ${
                  i === idx ? "ring-2 ring-slate-900 ring-offset-1" : ""
                } ${
                  rr.yourAnswer == null
                    ? "bg-slate-200 text-slate-600"
                    : rr.correct
                      ? "bg-green-100 text-green-700"
                      : "bg-rose-100 text-rose-700"
                }`}
                title={`Question ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        {q && r && (
          <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-6">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">
                Question {idx + 1} of {total}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  r.yourAnswer == null
                    ? "bg-slate-100 text-slate-600"
                    : r.correct
                      ? "bg-green-100 text-green-700"
                      : "bg-rose-100 text-rose-700"
                }`}
              >
                {r.yourAnswer == null
                  ? "Skipped"
                  : r.correct
                    ? "Correct"
                    : "Incorrect"}
              </span>
            </div>

            {hasStimulus(q) && (
              <div className="mb-4 space-y-3 border-b border-slate-200 pb-4">
                {q.stimulusImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={q.stimulusImage}
                    alt="Figure for this question"
                    className="mx-auto max-h-[40vh] w-auto rounded border border-slate-200"
                  />
                )}
                {q.stimulusTableHtml && (
                  <div
                    className="stimulus-table"
                    dangerouslySetInnerHTML={{ __html: q.stimulusTableHtml }}
                  />
                )}
                {q.passage && q.passage.trim() && (
                  <div className="whitespace-pre-line text-[16px] leading-relaxed text-slate-800">
                    {q.passage}
                  </div>
                )}
              </div>
            )}

            <p className="mb-4 text-[17px] font-medium leading-relaxed">
              <Q text={q.prompt} math={q.section === "math"} />
            </p>

            {q.type === "grid_in" ? (
              <GridInReview
                your={r.yourAnswer}
                correct={r.correctAnswer}
                isCorrect={r.correct}
              />
            ) : (
              <div className="space-y-2">
                {q.choices.map((c) => {
                  const key = c.key as AnswerKey;
                  const isCorrect = r.correctAnswer === key;
                  const isYours = r.yourAnswer === key;
                  let cls =
                    "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-[16px]";
                  if (isCorrect) cls += " border-green-600 bg-green-50";
                  else if (isYours) cls += " border-rose-500 bg-rose-50";
                  else cls += " border-slate-200";
                  return (
                    <div key={key} className={cls}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-400 text-sm font-semibold">
                        {key}
                      </span>
                      <span className="flex-1">
                        <Q text={c.text} math={q.section === "math"} />
                      </span>
                      {isCorrect && (
                        <span className="text-xs font-semibold text-green-700">
                          Correct answer
                        </span>
                      )}
                      {isYours && !isCorrect && (
                        <span className="text-xs font-semibold text-rose-700">
                          Your answer
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Explanation
              </p>
              <p className="text-sm leading-relaxed text-slate-700">
                <Q text={r.explanation} math={q.section === "math"} />
              </p>
            </div>
          </main>
        )}

        <footer className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            ◀ Prev
          </button>
          <span className="text-sm font-medium text-slate-600">
            {idx + 1} / {total}
          </span>
          {idx < total - 1 ? (
            <button
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white"
            >
              Next ▶
            </button>
          ) : (
            <Link
              href="/dashboard"
              className="rounded-full bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Done
            </Link>
          )}
        </footer>
      </div>
    );
  }

  // ---------- Test runner ----------
  if (!session || total === 0) return <Centered>Loading…</Centered>;
  const q = questions[idx];
  const isMath = q.section === "math";
  const isGridIn = q.type === "grid_in";
  const elapsed = tick ? Date.now() - mountRef.current : 0;
  const elim = new Set(eliminated[q.id] ?? []);

  return (
    <div className="flex h-screen flex-col bg-white font-sans text-slate-900">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
        <div className="min-w-[160px]">
          <div className="text-[15px] font-bold">
            {SECTION_LABEL[q.section] ?? "Practice"}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
            <ClockIcon />
            <span>{showTimer ? fmt(elapsed) : "—:—"}</span>
          </div>
          <button
            onClick={() => setShowTimer((v) => !v)}
            className="rounded border border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            {showTimer ? "Hide" : "Show"}
          </button>
        </div>
        <div className="flex min-w-[160px] justify-end">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
            Save &amp; exit
          </Link>
        </div>
      </header>

      {/* Body */}
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
                <div
                  className="stimulus-table"
                  dangerouslySetInnerHTML={{ __html: q.stimulusTableHtml }}
                />
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
                  onClick={() => toggleMark(q.id)}
                  className={`flex items-center gap-1 text-sm ${
                    marked.has(q.id) ? "text-accent-600" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <BookmarkIcon filled={marked.has(q.id)} />
                  Mark for Review
                </button>
              </div>
              {!isGridIn && (
                <button
                  onClick={() => setCrossOut((v) => !v)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${
                    crossOut
                      ? "border-accent-600 bg-accent-50 text-accent-600"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                  title="Cross out answer choices"
                >
                  <span className="line-through">ABC</span>
                </button>
              )}
            </div>

            <p className="mb-5 text-[17px] font-medium leading-relaxed">
              <Q text={q.prompt} math={isMath} />
            </p>

            {isGridIn ? (
              <GridInInput
                value={answers[q.id] ?? ""}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
              />
            ) : (
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
                        onClick={() => !isCrossed && selectAnswer(q.id, key)}
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
                          onClick={() => toggleEliminated(q.id, key)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                          title={isCrossed ? "Undo" : "Cross out"}
                        >
                          <span className="line-through">{key}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Question navigator popover */}
      {showNav && (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5">
            {questions.map((qq, i) => {
              const isAns = !!answers[qq.id];
              const isMk = marked.has(qq.id);
              return (
                <button
                  key={qq.id}
                  onClick={() => goTo(i)}
                  className={`relative h-8 w-8 rounded text-xs font-semibold ${
                    i === idx ? "ring-2 ring-slate-900 ring-offset-1" : ""
                  } ${
                    isAns
                      ? "bg-accent-600 text-white"
                      : "border border-slate-300 bg-white text-slate-600"
                  }`}
                  title={`Question ${i + 1}${isMk ? " (marked)" : ""}`}
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

      {/* Bottom bar */}
      <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
        <button
          onClick={() => goTo(idx - 1)}
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
              onClick={() => goTo(idx + 1)}
              className="rounded-full bg-accent-600 px-6 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Next ▶
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting}
              className="rounded-full bg-accent-600 px-6 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Review & Submit"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// Renders question text, applying LaTeX only for math questions.
function Q({ text, math }: { text: string; math: boolean }) {
  return math ? <MathText text={text} /> : <>{text}</>;
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

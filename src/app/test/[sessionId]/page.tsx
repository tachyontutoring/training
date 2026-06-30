"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "@/lib/use-require-auth";
import type {
  AnswerKey,
  GradeResultClient,
  PublicQuestion,
  SessionDoc,
} from "@/lib/client-types";

type Phase = "loading" | "answering" | "feedback" | "finished";

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
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [coaching, setCoaching] = useState("");
  const [selected, setSelected] = useState<AnswerKey | null>(null);
  const [result, setResult] = useState<GradeResultClient | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Bluebook-style tools + per-question timer.
  const [marked, setMarked] = useState(false);
  const [crossOut, setCrossOut] = useState(false);
  const [eliminated, setEliminated] = useState<Set<AnswerKey>>(new Set());
  const [showTimer, setShowTimer] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(0);

  // Load the session — prefer the handoff stashed by the dashboard.
  useEffect(() => {
    if (!user) return;
    const cached = sessionStorage.getItem(`session:${sessionId}`);
    if (cached) {
      const data = JSON.parse(cached);
      setSession(data.session);
      setQuestion(data.question);
      setCoaching(data.coaching || "");
      setPhase(data.session.status === "completed" ? "finished" : "answering");
      sessionStorage.removeItem(`session:${sessionId}`);
      return;
    }
    authedFetch(`/api/session/${sessionId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load session");
        setSession(d.session);
        setQuestion(d.question);
        setPhase(d.session.status === "completed" ? "finished" : "answering");
      })
      .catch((e) => setError(e.message));
  }, [user, sessionId, authedFetch]);

  // Reset tools + (re)start the clock whenever a new question is shown.
  useEffect(() => {
    if (phase !== "answering" || !question) return;
    setMarked(false);
    setCrossOut(false);
    setEliminated(new Set());
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 250);
    return () => clearInterval(id);
  }, [question?.id, phase]);

  const submit = useCallback(async () => {
    if (!selected || !question || !session) return;
    const timeMs = Date.now() - startRef.current;
    setElapsedMs(timeMs);
    setBusy(true);
    setError("");
    try {
      const res = await authedFetch("/api/answer", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          questionId: question.id,
          selectedAnswer: selected,
          timeMs,
        }),
      });
      const data: GradeResultClient = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || "Error");
      setResult(data);
      setSession(data.session);
      setPhase("feedback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit answer");
    } finally {
      setBusy(false);
    }
  }, [selected, question, session, sessionId, authedFetch]);

  function next() {
    if (!result) return;
    if (result.finished || !result.next) {
      setPhase("finished");
      return;
    }
    setQuestion(result.next);
    setCoaching(result.coaching || "");
    setSelected(null);
    setResult(null);
    setPhase("answering");
  }

  function toggleEliminated(key: AnswerKey) {
    setEliminated((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });
  }

  if (loading || phase === "loading") {
    return <Centered>Loading your test…</Centered>;
  }
  if (error) {
    return (
      <Centered>
        <p className="mb-4 text-rose-600">{error}</p>
        <Link
          href="/dashboard"
          className="rounded-md bg-slate-900 px-4 py-2 text-white"
        >
          Back to dashboard
        </Link>
      </Centered>
    );
  }

  if (phase === "finished" && session) {
    const pct = session.answered
      ? Math.round((session.correct / session.answered) * 100)
      : 0;
    const avg = session.answered
      ? (session.totalTimeMs ?? 0) / session.answered
      : 0;
    return (
      <Centered>
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-600">
            Reading & Writing · Complete
          </p>
          <div className="my-4 text-6xl font-bold text-slate-900">{pct}%</div>
          <p className="mb-6 text-slate-600">
            {session.correct} of {session.answered} correct
          </p>
          <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-lg font-semibold">{fmt(session.totalTimeMs ?? 0)}</div>
              <div className="text-xs text-slate-500">Total time</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-lg font-semibold">{fmt(avg)}</div>
              <div className="text-xs text-slate-500">Avg / question</div>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-accent-600 px-5 py-2.5 font-medium text-white hover:bg-accent-700"
          >
            Back to dashboard
          </Link>
        </div>
      </Centered>
    );
  }

  if (!question || !session) return <Centered>Loading…</Centered>;

  const questionNumber = session.answered + 1;
  const isFeedback = phase === "feedback";

  return (
    <div className="flex h-screen flex-col bg-white font-sans text-slate-900">
      {/* ---------- Top bar ---------- */}
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-2.5">
        <div className="min-w-[180px]">
          <div className="text-[15px] font-bold">
            {SECTION_LABEL[question.section] ?? "Practice"}
          </div>
          <button className="text-xs text-accent-600 underline-offset-2 hover:underline">
            Directions
          </button>
        </div>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
            <ClockIcon />
            <span>{showTimer ? fmt(elapsedMs) : "—:—"}</span>
          </div>
          <button
            onClick={() => setShowTimer((v) => !v)}
            className="rounded border border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            {showTimer ? "Hide" : "Show"}
          </button>
        </div>

        <div className="flex min-w-[180px] justify-end">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
            Exit
          </Link>
        </div>
      </header>

      {coaching && !isFeedback && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-center text-xs italic text-amber-800">
          {coaching}
        </div>
      )}

      {/* ---------- Body: split screen ---------- */}
      <main className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
        {/* Left: stimulus — figure/table and/or passage */}
        <section className="overflow-y-auto border-slate-200 px-6 py-6 md:border-r lg:px-10">
          <div className="mx-auto max-w-prose space-y-4">
            {question.stimulusImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={question.stimulusImage}
                alt="Figure for this question"
                className="mx-auto max-h-[55vh] w-auto rounded border border-slate-200"
              />
            )}
            {question.stimulusTableHtml && (
              <div
                className="stimulus-table"
                dangerouslySetInnerHTML={{ __html: question.stimulusTableHtml }}
              />
            )}
            {question.passage ? (
              <div className="whitespace-pre-line text-[17px] leading-relaxed text-slate-800">
                {question.passage}
              </div>
            ) : (
              !question.stimulusImage &&
              !question.stimulusTableHtml && (
                <span className="text-slate-400">No passage for this question.</span>
              )
            )}
          </div>
        </section>

        {/* Right: question + choices */}
        <section className="overflow-y-auto px-6 py-5 lg:px-10">
          <div className="mx-auto max-w-prose">
            {/* question header row */}
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-900 text-sm font-bold text-white">
                  {questionNumber}
                </span>
                <button
                  onClick={() => setMarked((v) => !v)}
                  className={`flex items-center gap-1 text-sm ${
                    marked ? "text-accent-600" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <BookmarkIcon filled={marked} />
                  Mark for Review
                </button>
              </div>
              <button
                onClick={() => setCrossOut((v) => !v)}
                disabled={isFeedback}
                className={`rounded border px-2 py-1 text-xs font-semibold ${
                  crossOut
                    ? "border-accent-600 bg-accent-50 text-accent-600"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                } disabled:opacity-40`}
                title="Cross out answer choices"
              >
                <span className="line-through">ABC</span>
              </button>
            </div>

            <p className="mb-5 text-[17px] font-medium leading-relaxed">
              {question.prompt}
            </p>

            <div className="space-y-3">
              {question.choices.map((c) => {
                const key = c.key as AnswerKey;
                const isSel = selected === key;
                const isCorrect = result?.correctAnswer === key;
                const isWrongPick = isFeedback && isSel && !result?.correct;
                const isCrossed = eliminated.has(key);

                let box =
                  "relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-[16px] transition-colors";
                if (isFeedback && isCorrect)
                  box += " border-green-600 bg-green-50";
                else if (isWrongPick) box += " border-rose-500 bg-rose-50";
                else if (isSel) box += " border-accent-600 bg-accent-50";
                else box += " border-slate-300 hover:border-slate-400";

                return (
                  <div key={key} className="flex items-center gap-2">
                    <button
                      className={`${box} flex-1 ${isCrossed ? "opacity-40" : ""}`}
                      disabled={isFeedback || (isCrossed && !isSel)}
                      onClick={() => !isCrossed && setSelected(key)}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                          isSel && !isFeedback
                            ? "border-accent-600 bg-accent-600 text-white"
                            : "border-slate-400 text-slate-700"
                        }`}
                      >
                        {key}
                      </span>
                      <span className={isCrossed ? "line-through" : ""}>{c.text}</span>
                    </button>
                    {crossOut && !isFeedback && (
                      <button
                        onClick={() => toggleEliminated(key)}
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

            {isFeedback && result && (
              <div
                className={`mt-5 rounded-lg border p-4 ${
                  result.correct
                    ? "border-green-200 bg-green-50"
                    : "border-rose-200 bg-rose-50"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <p
                    className={`font-semibold ${
                      result.correct ? "text-green-700" : "text-rose-700"
                    }`}
                  >
                    {result.correct
                      ? "Correct"
                      : `Incorrect — correct answer is ${result.correctAnswer}`}
                  </p>
                  <span className="text-xs text-slate-500">
                    Time: {fmt(elapsedMs)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-700">
                  {result.explanation}
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ---------- Bottom bar ---------- */}
      <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
        <div className="min-w-[160px] truncate text-sm font-medium text-slate-600">
          {user?.displayName || user?.email}
        </div>
        <div className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">
          Question {questionNumber} of {session.targetCount}
        </div>
        <div className="flex min-w-[160px] justify-end">
          {!isFeedback ? (
            <button
              className="rounded-full bg-accent-600 px-6 py-2 font-medium text-white hover:bg-accent-700 disabled:opacity-40"
              disabled={!selected || busy}
              onClick={submit}
            >
              {busy ? "Checking…" : "Submit"}
            </button>
          ) : (
            <button
              className="rounded-full bg-accent-600 px-6 py-2 font-medium text-white hover:bg-accent-700"
              onClick={next}
            >
              {result?.finished || !result?.next ? "See results" : "Next"}
            </button>
          )}
        </div>
      </footer>
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

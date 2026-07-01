"use client";

// UI for grid-in (student-typed, free-response) math questions — used by both
// the practice-test runner and the Bluebook session runner in place of the
// A–D choice list.

export function GridInInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-600">
        Enter your answer
      </label>
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 7, -5, 3/8"
        className="w-52 rounded-lg border border-slate-300 px-4 py-3 text-[16px] tabular-nums focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600"
      />
      <p className="mt-2 text-xs text-slate-400">
        Fractions (3/8) and decimals (0.375) are both accepted.
      </p>
    </div>
  );
}

// Review display: the student's typed answer, colored by correctness, plus the
// correct answer when they missed it.
export function GridInReview({
  your,
  correct,
  isCorrect,
}: {
  your: string | null;
  correct: string;
  isCorrect: boolean;
}) {
  const yourCls =
    your == null
      ? "border-slate-200"
      : isCorrect
        ? "border-green-600 bg-green-50"
        : "border-rose-500 bg-rose-50";
  return (
    <div className="space-y-2">
      <div
        className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-[16px] ${yourCls}`}
      >
        <span className="text-slate-500">Your answer</span>
        <span className="font-semibold tabular-nums">{your ?? "—"}</span>
      </div>
      {!isCorrect && (
        <div className="flex items-center justify-between rounded-lg border border-green-600 bg-green-50 px-4 py-2.5 text-[16px]">
          <span className="text-slate-500">Correct answer</span>
          <span className="font-semibold tabular-nums">{correct}</span>
        </div>
      )}
    </div>
  );
}

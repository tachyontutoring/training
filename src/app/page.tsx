import Link from "next/link";

export default function Home() {
  return (
    <main id="main" className="relative min-h-screen overflow-hidden border-b border-line">
      {/* graph-paper motif */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid-paper" />

      <div className="wrap relative">
        <div className="flex min-h-screen flex-col justify-center py-28">
          <div className="max-w-3xl">
            {/* kicker */}
            <div className="mb-6 flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-600" />
              <span className="mono-label">School of Athens · Cambridge, MA</span>
            </div>

            <h1 className="font-display text-display-xl font-bold text-ink">
              <span className="block animate-fade-up">Master the digital SAT,</span>
              <span
                className="block text-accent-600 animate-fade-up"
                style={{ animationDelay: "100ms" }}
              >
                one question at a time.
              </span>
            </h1>

            <p
              className="mt-7 max-w-xl text-lg leading-relaxed text-ink-soft animate-fade-up sm:text-xl"
              style={{ animationDelay: "180ms" }}
            >
              Adaptive practice that learns how you learn. Take a full practice test or drill
              reading and math — every answer sharpens what comes next, and your tutor sees
              exactly where you stand.
            </p>

            <div
              className="mt-10 flex flex-col items-start gap-5 animate-fade-up sm:flex-row sm:items-center sm:gap-7"
              style={{ animationDelay: "260ms" }}
            >
              <Link href="/signup" className="btn-primary group">
                Get started
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
              <Link href="/login" className="btn-ghost">
                I have an account
              </Link>
            </div>

            <p
              className="mt-12 max-w-xl text-[15px] italic text-ink-muted animate-fade-up"
              style={{ animationDelay: "340ms" }}
            >
              Practice questions written and checked by hand, scored the moment you answer.
            </p>
          </div>
        </div>

        {/* tutor entry — bottom rail */}
        <Link
          href="/tutor/signup"
          className="absolute bottom-7 left-[var(--gutter)] font-mono text-[11px] uppercase tracking-label text-ink-muted hover:text-accent-600"
        >
          Are you a tutor? Set up your console →
        </Link>
      </div>
    </main>
  );
}

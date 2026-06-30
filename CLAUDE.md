# School of Athens — SAT practice portal

Next.js + Firebase web app where students take adaptive SAT **Reading & Writing**
practice (Bluebook-style UI, per-question timing) and tutors manage students and
assign practice sets. "School of Athens" is the tutoring company.

## Stack & commands

- **Next.js 15** (App Router, TS), **React 19**, **pnpm**, **Tailwind 3.4**
- **Firebase**: Auth (email/password) + Firestore. Admin SDK server-side, client SDK (Auth only) in browser.
- **Anthropic SDK** for adaptive question selection (optional — heuristic fallback).

```bash
pnpm dev          # dev server (port 3000, or 3001 if taken)
pnpm build        # production build (prebuilds routes; do this to typecheck)
pnpm seed         # seed Firestore from the questions repo + build local snapshot + copy figures
SNAPSHOT_ONLY=1 pnpm seed   # rebuild local snapshot + figures WITHOUT Firestore writes
```

`pnpm install` is sometimes blocked by the sandbox here; if so, ask the user to run `! pnpm install`.

## Architecture (read this before changing data flow)

**The browser never reads/writes Firestore directly.** The client SDK is used
for Auth only. Every read/write goes through Next.js API routes using the Admin
SDK (which bypasses security rules). The client attaches its Firebase ID token
via `Authorization: Bearer <token>` (see `authedFetch` in `src/lib/auth-context.tsx`);
routes verify it with `requireUid`/`requireUser`/`requireTutor` (`src/lib/server-auth.ts`).

Consequence: `firestore.rules` deny essentially everything from the client by
design — don't "fix" them to allow client access. The question bank (with answers)
is never sent to the browser; `toPublicQuestion()` strips `correctAnswer`/`explanation`.

### Question bank = static reference data, loaded from a LOCAL SNAPSHOT
`src/lib/question-bank.ts` loads the whole bank into memory from
**`data/question-bank.json`** (a snapshot written by `pnpm seed`), NOT from
Firestore. This is deliberate and important: reading the ~1,687-doc collection
on every server boot/cold-start/HMR previously burned ~50k Firestore reads/day
and blew the free quota. Keep serving off the snapshot.

- Cache is stashed on `globalThis` so dev hot-reloads reuse it.
- `src/instrumentation.ts` warms the cache at server startup.
- After re-seeding, **restart the dev server** (or call `refresh()`) to pick up changes.
- Firestore still stores the bank as source of truth, but the app doesn't read it there.

### Adaptive engine
`src/lib/session-service.ts` is the game engine: create sessions, grade answers,
update progress, pick the next question. `src/lib/claude.ts` asks Claude to pick
the next question from a small candidate pool + write a coaching note; if
`ANTHROPIC_API_KEY` is unset (or the call fails) a deterministic heuristic
(weakest-skill + difficulty nudge) is used, so the app always works.

- Free-practice sessions: questions sampled adaptively from the bank.
- **Assignment** sessions (`session.queue` + `assignmentId`): serve a fixed
  ordered list; on finish, write results back to the `assignments` doc.

## Firestore data model

| Path | Contents |
|------|----------|
| `questions/{id}` | Bank: section, skill, difficulty (2/3/4), passage, choices, correctAnswer, explanation, `stimulusImage`, `stimulusTableHtml`, `rand` |
| `users/{uid}` | Profile: `role` (`student`\|`tutor`), email, displayName, `tutorId` (students), aggregate `progress` |
| `users/{uid}/sessions/{sid}` | A test session (counts, `totalTimeMs`, `queue`, `assignmentId`, `currentQuestionId`) |
| `users/{uid}/sessions/{sid}/responses/{qid}` | One graded response incl. `timeMs` |
| `assignments/{id}` | Tutor-assigned set: tutorId, studentId, title, criteria, questionIds, status, score |

Types live in `src/lib/types.ts` (server) and are re-exported via
`src/lib/client-types.ts` (a client-safe module that NEVER imports the Admin SDK —
import client types from here, not from modules that pull in `firebase-admin`).

## Tutor platform

- Tutor signup at `/tutor/signup` is gated by `TUTOR_ACCESS_CODE` (in `.env.local`).
- Tutors add students by email (`addStudentByEmail` → stamps `tutorId` on the student).
- Login routes by role (`/api/me` returns the profile; tutors → `/tutor`, students → `/dashboard`).
- Practice sets are **criteria-based** (skills + difficulties + count); `sampleByCriteria` picks the questions.
- All tutor routes call `requireTutor` (403 for students) and only touch the caller's own roster/assignments.

## Questions source & figures

- Source of truth: the sibling repo `../questions` (`tachyontutoring/questions`),
  file `data/rw/rw-qbank-generated.json` — the **Claude-generated RW** bank only
  (NOT the official CollegeBoard banks). Path is set by `RW_QUESTIONS_PATH`.
- Only RW is wired up; Math is "coming soon" in the dashboard.
- Difficulty maps Easy→2, Medium→3, Hard→4.
- **Figures** (`scripts/seed-questions.ts`):
  - Graph questions → PNG copied to `public/figures/`, stored as `stimulusImage`.
  - Table questions → LaTeX `tabular` converted to sanitized HTML (`stimulusTableHtml`); rendered via the `.stimulus-table` styles in `globals.css`.

## Styling

Design system adapted from the sibling `../sat-tutoring` ("Tachyon") site:
warm **paper/ink** palette + **ultramarine accent**, Helvetica display + **Space Mono**
labels, graph-paper motif, hairline editorial layout. Tokens are CSS vars in
`globals.css` (with a `.dark` block ready) exposed as Tailwind colors
(`paper`, `ink`, `line`, `accent`). Component classes: `.btn-primary/.btn-secondary/.btn-ghost`,
`.card`, `.input`, `.mono-label`, `.wrap`, `.grid-paper`.

Exception: the **test runner** (`src/app/test/[sessionId]/page.tsx`) intentionally
keeps a clean white **Bluebook** surface (slate neutrals) to mimic the real digital
SAT, with the accent recolored to the brand ultramarine.

## Env (`.env.local`)

- `NEXT_PUBLIC_FIREBASE_*` — client config (project `athens-6174e`)
- `FIREBASE_SERVICE_ACCOUNT_B64` — base64 service-account JSON (Admin SDK; required for grading/seeding)
- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-4-6`)
- `TUTOR_ACCESS_CODE`
- `RW_QUESTIONS_PATH`, `RW_IMG_DIR`
- `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1` to use the local emulator (needs Java + firebase-tools)

## Gotchas

- **Don't re-seed casually** — full `pnpm seed` writes ~1,687 docs (separate 20k/day write quota). Use `SNAPSHOT_ONLY=1` to refresh the local snapshot/figures with zero Firestore ops.
- Env var changes require a **dev server restart** (Next loads `.env` at boot).
- When verifying against the real project, create throwaway users with `@schoolofathens.test` emails and delete them afterward (Admin SDK) to keep the project clean.
- New deps can't be installed in this sandbox — avoid adding libraries (we used inline SVGs instead of an icon lib, and skipped `next-themes`).

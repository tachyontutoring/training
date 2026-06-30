# School of Athens — Adaptive SAT Practice

A Next.js + Firebase web app where students log in, take full SAT practice
tests or drill Reading & Writing / Math, and have every answer scored and
logged. After each answer the server calls the **Claude API** to choose the
best next question from the bank based on the learner's performance.

## Stack

- **Next.js** (App Router, TypeScript) — UI + API routes
- **pnpm** — package manager
- **Firebase Auth** (email/password) — accounts
- **Cloud Firestore** — user accounts, progress, sessions, and the question bank
- **Firebase Admin SDK** — server-side grading and Firestore writes
- **@anthropic-ai/sdk** — adaptive next-question selection + coaching notes

## Architecture

```
Browser (client SDK: Auth only)
  │  Firebase ID token in Authorization header
  ▼
Next.js API routes  ──Admin SDK──▶  Firestore  (questions/ users/ …)
  /api/session            grade, write progress
  /api/answer    ──▶  src/lib/claude.ts  ──▶  Claude API (pick next question)
  /api/progress
```

Key safety property: **the question bank — including correct answers and
explanations — is never sent to the browser.** All grading and question
delivery happen in API routes via the Admin SDK (which bypasses Firestore
rules). Clients can only read their own profile/progress (see `firestore.rules`).

### Firestore data model

| Path | Contents |
|------|----------|
| `questions/{id}` | Question bank: section, skill, difficulty, prompt, choices, correctAnswer, explanation |
| `users/{uid}` | Profile + aggregate `progress` stats |
| `users/{uid}/sessions/{sid}` | A test session: type, counts, served question ids, current question |
| `users/{uid}/sessions/{sid}/responses/{qid}` | One graded response |

## Getting started

```bash
pnpm install
cp .env.local.example .env.local   # then fill in values
```

### Option A — Local development with the Firebase emulator (no real keys)

```bash
# .env.local
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1
NEXT_PUBLIC_FIREBASE_PROJECT_ID=school-of-athens
# (ANTHROPIC_API_KEY optional — without it, a heuristic picks the next question)

pnpm dlx firebase-tools emulators:start   # terminal 1  (Auth :9099, Firestore :8080)
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 pnpm seed   # terminal 2 — load the question bank
pnpm dev                                          # terminal 3 — http://localhost:3000
```

### Option B — Real Firebase project

1. Create a Firebase project; enable **Authentication → Email/Password** and **Firestore**.
2. Copy the web app config into the `NEXT_PUBLIC_FIREBASE_*` vars in `.env.local`.
3. Generate a service account key (Project settings → Service accounts), then:
   ```bash
   base64 -i serviceAccountKey.json | tr -d '\n'   # paste into FIREBASE_SERVICE_ACCOUNT_B64
   ```
4. Set `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`, default `claude-sonnet-4-6`).
5. Deploy rules/indexes and seed:
   ```bash
   pnpm dlx firebase-tools deploy --only firestore:rules,firestore:indexes
   pnpm seed
   pnpm dev
   ```

## Adaptive engine

`src/lib/claude.ts` sends Claude the learner's recent answers, per-skill
accuracy, and a list of candidate questions; Claude returns the id of the next
question plus a short coaching note. If `ANTHROPIC_API_KEY` is unset or the call
fails, a deterministic heuristic (target the weakest skill, nudge difficulty by
the last result) is used instead, so the app always works.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm seed` | Load the starter question bank into Firestore |
| `pnpm emulators` | Start the Firebase emulator suite (needs firebase-tools) |

## Extending the question bank

Add entries to `QUESTIONS` in `scripts/seed-questions.ts` (or write directly to
the `questions` collection). Each question needs `section`, `skill`,
`difficulty` (1–5), `prompt`, four `choices`, `correctAnswer`, and `explanation`.
# training

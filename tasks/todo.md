# MockMentor — Scan Findings & 5-Step Plan

> **Status: Step 1 done ✅. Waiting for your go-ahead before Step 2.**
> One step at a time: I tick the boxes as I go and check in with you after each step.

---

## Part 1 — What the code scan found

I read every source file (about 10.8k lines of TS/TSX/Python). File references are `path:line`.

### 1. Broken right now
- **Every interview-session request fails.** `app/api/interview-session/route.ts:9` reads the request body, then line 24 reads it again. The second read returns `{}` (reproduced in Node), so every call returns 400. As a result:
  - no session is created;
  - no messages are saved;
  - the "Generate Report" button never shows (`components/interview-complete.tsx:125` needs a `sessionId`).
- **Guests can never get a report.**
  - `lib/models/InterviewReport.ts:158` marks `userId` as required, and guests don't have one, so saving the report fails.
  - `components/interview-report.tsx:108` fetches the report without a `guestId`, so guests get a 401.
  - The report model has no `guestId` field.
- **Two timers race each other.**
  - `app/interview/[id]/page.tsx:136` counts 3 minutes from page load.
  - `components/interview.tsx:133` counts 3 minutes from the Start click.
  - The page timer always wins. It swaps in `<InterviewComplete />` with no props, so `exitInterview()` never runs.
  - A third timeout exists: the server marks interviews complete after 5 minutes (`app/api/interview/[id]/route.ts:37`).
- **The guest limit does nothing.**
  - The increment isn't awaited or `.exec()`'d, so it never runs (`interview-session/route.ts:187`).
  - `components/navbar.tsx:17` creates a new guest on every click.
  - The limit is checked when an interview is created but counted when it ends.
- **Typing in the transcript box and pressing Enter calls `stop()`** (`interview.tsx:557`). That ends the interview and clears the transcript. The Send button is disabled.
- **The mic button only changes its icon.** `isMicOn` is never used for anything else.
- **The "user went silent" nudge (`[USER_PAUSED]`) can never fire.** `hooks/useSpeechToText.ts:134` only calls back when there is text.

### 2. Security
- **Almost every route is effectively unauthenticated.**
  - `middleware.ts` makes almost every API route public.
  - Routes accept any `guestId` string.
  - `/api/ai-chat` has no check at all.
- **`/api/ai-chat` is an open proxy to your Groq key.** The client builds the system prompt (`knowledgeBase` in `app/interview/[id]/page.tsx:214`).
- **Resume upload has no limits.**
  - `upload-resume` stores the file in Appwrite *before* any validation, with no size limit (`upload-resume/route.ts:27-32`).
  - `.doc`/`.docx` files are decoded as UTF-8, so the LLM receives binary garbage.
- **No ownership checks.** `interview-session` actions don't check who owns the interview. Bug #1 hides this today, and fixing #1 would expose it.
- **Client data is stored unvalidated.** `faceAnalytics` and `metricsData` from the client are saved as-is. `metricsData` is spread straight into `session.metrics`, and Mongoose has a prototype-pollution advisory.
- **Smaller issues:**
  - `lib/mongodb.ts:48` hardcodes your IP address.
  - `process-resume` logs resume summaries, which are personal data.
  - An invalid ObjectId gives a 500 error instead of a 404.

### 3. The scores are built on made-up numbers
- `conversationMetrics` (`interview.tsx:66`) has no setter, so it stays at zero.
  - Speaking time is `totalDuration/2`.
  - `emotionalTone` is hardcoded (`:360`).
  - Each message is saved with placeholder `duration: 3000, confidence: 0.9` (`:204`).
- The `'you know'` filler word can never match, because the text is split into single words.
- Face analytics are never sent to the report prompt, so the LLM invents the "body language" score.
- Face tracking has several weaknesses:
  - hand and posture tracking are stubs;
  - blink detection runs at 5 fps and misses blinks;
  - calibration resets on every question;
  - it only tries the GPU;
  - the local model path returns 404 every time.

### 4. Code quality
- `generate-report` re-implements `generateWithGroq`, tries the weaker 8b model first, parses the JSON by stripping code fences with a regex, and has a ~150-line made-up fallback report.
- `upload-resume` and `process-resume` duplicate the same pipeline. The base64-PDF branch in `process-resume` is never used.
- A server route imports `components/mentors.tsx`, which is a UI file.
- `InterviewReport.interviewId` isn't unique, so duplicate reports are possible. `GuestUser` declares its index twice.
- In `lib/groq.ts`, `clearTimeout` isn't in a `finally` block, so the timer leaks on errors.
- `useFaceTracker` sets state 5 times a second, which re-renders the whole 640-line `Interview` component.
- The spoken "look at the camera" alert is picked up by the mic and recorded as the user's answer.
- Unused code:
  - the session actions `add_messages_batch` and `update_metrics`;
  - the `isMuted` field in the voice context.
- The error message mentions a "dashboard" that doesn't exist.
- `tsconfig` has `strict: false`, there are no tests and no CI, and `next lint` is deprecated.

### 5. Dead weight
- **Unused deps:**
  - `freebuff` (brings in the **critical** `tar` vulnerability), `openai`, `@google/generative-ai`, `@ai-sdk/google`, `appwrite`;
  - `ahooks` (used once) and `uuid`;
  - unused `@types/*` packages.
- **Unused files:**
  - `lib/gemini.ts`, `lib/appwrite.ts`, `getAllPrompts()`;
  - `install.sh` and `install.sh.asc` (the Brave browser installer);
  - 12 loose `.md` notes at the repo root.

### 6. Dependencies
- `npm audit`: 11 vulnerabilities, 2 of them critical (`next`, and `tar` via `freebuff`).
- Major upgrades are available (Next 16, Clerk 7, `ai` 7, Mongoose 9). Leave these until the fixes are done.

---

## Part 2 — Decisions (from you)
- [x] If the AI fails, show an error with a retry button. Never save a made-up report.
- [x] Leave the Python sidecar (`model/`, `render.yaml`) untouched, since it will be integrated later.
- [x] Keep `/test-face` and `/test-speech`, but make them dev-only (404 in production).

---

## Part 3 — The 5-step plan

Order: working flow → secure API → correct live experience → honest scores. Each step leaves the app buildable and verified.

### Step 1 — Cleanup and a working verification baseline
- [x] Record the current lint and type errors first, since `next build` fails on lint errors.
- [x] Remove unused deps:
  - `freebuff`, `openai`, `@google/generative-ai`, `@ai-sdk/google`, `appwrite`;
  - `ahooks`: turn its one `useUnmount` into a `useEffect` cleanup;
  - `uuid` + `@types/uuid`: use `crypto.randomUUID()`;
  - unused `@types/*`, keeping any that `tsc` needs.
- [x] Delete `lib/gemini.ts`, `lib/appwrite.ts`, `getAllPrompts()`, `install.sh` and `install.sh.asc`. Keep `lib/mlSidecar.ts`.
- [x] Make the test pages dev-only:
  - move them to `app/(dev)/test-face` and `app/(dev)/test-speech` (the URLs stay the same);
  - add `app/(dev)/layout.tsx` that calls `notFound()` in production.
- [x] Move the 12 root `.md` notes (all except README and CLAUDE) into `docs/`. Nothing is deleted.
- [x] Patch security issues without major upgrades:
  - re-run `npm install` to remove the deleted deps;
  - bump `next` to the latest 15.5.x, and `eslint-config-next` to match;
  - run `npm audit fix` (non-breaking only).
- [x] Scripts:
  - change `lint` to `eslint .`;
  - add `typecheck` (`tsc --noEmit`) and `test` (`node --test`, which is built into Node 24, so no new dependency).
- [x] Add CI in `.github/workflows/ci.yml`: `npm ci`, lint, typecheck and test. The build stays a local check, because it needs real env vars.
- [x] **Verify:**
  - lint, typecheck and build all pass;
  - no critical `npm audit` findings;
  - `/test-face` works in dev and returns 404 under `next start`;
  - the landing page and `/interview/new` render.

### Step 2 — Fix the interview → report flow
- [ ] New `lib/requester.ts`:
  - `getRequester(req)`: Clerk `userId`, plus a guest id from an `x-guest-id` header;
  - `isOwner(doc, requester)`;
  - validate ObjectIds so bad ids return 404.
  - It replaces the copy-pasted ownership checks in the interview, interview-session and generate-report routes.
- [ ] Client side: a small `guestHeaders()` helper, used at the ~20 fetch sites that send `guestId` today.
- [ ] `interview-session`:
  - read the body once;
  - check ownership on every action;
  - make `start` idempotent (a refresh reuses the active session);
  - delete the unused `add_messages_batch` and `update_metrics` actions.
- [ ] Guest limit: one atomic check-and-increment in `create-interview`, and remove the broken increment from `end`.
- [ ] One timer, with the server as the source of truth:
  - add `interviewDurationSec: 180` to `lib/appConfig.ts`;
  - delete the page-level timer and the auto-start PATCH in `app/interview/[id]/page.tsx`;
  - the session starts when the user clicks **Start** and returns `startTime`;
  - the countdown runs only while connected, calculated from `startTime`;
  - the server's stale auto-complete uses the config value plus a 2-minute grace period.
- [ ] Completed interviews: pass `interviewId` and `sessionId` into `<InterviewComplete />`, so the report can still be generated or viewed later.
- [ ] Models:
  - `InterviewReport`: make `userId` optional, add `guestId`, and make `interviewId` unique (check the DB for duplicates first);
  - `GuestUser`: remove the duplicate index.
- [ ] New `GET /api/report/[id]` with an owner check, added to the public list in `middleware.ts`. The report page uses it, so opening the report page never triggers an AI call. If no report exists yet, it shows "not generated yet".
- **Verify** (end-to-end, as a signed-in user and as a guest):
  - create → start → answer twice → end → generate → view report;
  - Mongo has one session with its messages and one report;
  - a guest's second interview returns 403;
  - a refresh keeps the timer and the session;
  - `/api/interview-session` returns 200.

### Step 3 — Secure the API
- [ ] A guest id counts only if that `GuestUser` exists. A Clerk user id takes precedence.
- [ ] `/api/ai-chat`:
  - takes `interviewId` and checks ownership;
  - requires the interview to be `in-progress` and within its time limit plus grace (this caps usage without a rate-limit library);
  - builds the prompt on the server: `getKnowledgeBase()` moves to `lib/promptHelper.ts`, and the mentor data moves to `lib/mentors.ts`;
  - the client stops sending `knowledgeBase`, and the history it sends is capped at 20 messages of 2,000 characters each.
- [ ] `upload-resume`: check type (PDF or TXT, including the `%PDF` magic bytes) and size (≤ 5 MB), and parse the file **before** uploading it to Appwrite.
- [ ] `process-resume`: text only, capped at 20k characters. Share one "summarise + save profile" helper with `upload-resume`.
- [ ] Restrict the file picker to `accept=".pdf,.txt"`.
- [ ] Navbar guest login reuses the existing guest id.
- [ ] Validate client data:
  - a pure `sanitizeFaceAnalytics()`;
  - keep only the known metric fields in session metrics.
- [ ] Remove the hardcoded IP, the resume-summary logs, and the noisy speech-recognition logs.
- **Verify:**
  - `node --test` passes for `sanitizeFaceAnalytics`;
  - curl `ai-chat` with a bad or missing identity → 4xx; as the owner → 200; after time runs out → 4xx;
  - a 10 MB file, a `.docx` file and a fake PDF are rejected, and nothing new appears in the Appwrite bucket;
  - the Step 2 flow still passes.

### Step 4 — Fix the live interview experience
- [ ] Typed answers work: add `sendText()` to `useVoiceInterview`, reusing `handleUserSpeech`. Enter and Send submit the answer instead of calling `stop()`. This also gives Firefox users a way to answer.
- [ ] The mic button really mutes: reuse the unused `isMuted` field, and the mic isn't restarted while muted.
- [ ] The silence nudge fires: a ~10 s no-speech timer triggers `[USER_PAUSED]`. Fix the prompt wording to match.
- [ ] Replace the spoken gaze alert with an on-screen banner, so the transcript isn't polluted.
- [ ] Face tracker:
  - try the GPU, then fall back to the CPU;
  - drop the local model path that returns 404;
  - raise the frame rate from 5 to 10 fps;
  - keep calibration between questions.
- [ ] Camera permission errors show a message.
- [ ] Replace the `alert()`s on the setup page with an inline error.
- [ ] Only if profiling shows it's needed: move the camera panel into its own component, to stop re-renders at 5–10 Hz.
- **Verify** (Chrome and Firefox):
  - typed answers get AI replies;
  - mute stops transcription;
  - staying silent for about 10 s gets a nudge;
  - looking away shows the banner and adds nothing to the transcript;
  - denying the camera shows a message.

### Step 5 — Make the scores honest
- [ ] `useSpeechToText` returns real `durationMs` for each answer. Each message stores `durationMs` and `pauseBefore`.
- [ ] Add a pure `lib/speechMetrics.ts` → `computeSpeechMetrics()` (speaking time, words per minute, response time, fillers including "you know"). Then delete all the fake metrics in `interview.tsx`.
- [ ] Report prompt:
  - add real body-language numbers from the face summary;
  - rename "Confidence Index" to "fluency";
  - with no camera data, `bodyLanguage` is omitted and the UI shows "Not assessed".
- [ ] Structured output with a zod schema in `lib/reportSchema.ts`, using `Output.object` from the installed `ai` v6. `zod` is already in the dependency tree, so it just becomes a direct dependency. This removes the regex JSON parsing.
- [ ] Reuse `generateWithGroq`:
  - add `models` and `output` options;
  - move `clearTimeout` into `finally`;
  - the report tries 70b first;
  - delete the duplicate model loop.
- [ ] Delete the ~150-line fallback report. If the AI fails, return 503 and save nothing; the existing retry UI handles it.
- **Verify:**
  - `node --test` passes for `computeSpeechMetrics` and for a sample report against the schema;
  - end-to-end with the camera on and off, the prompt contains real numbers;
  - with a bad `GROQ_API_KEY` → 503 and a retry button, and no report is saved.

---

## Not in this plan (follow-ups once the above is stable)
- Streaming AI replies (`streamText`, speaking sentence by sentence).
- Whisper speech-to-text via the existing `@ai-sdk/groq` (works in Firefox).
- A dashboard with interview history and a score trend.
- Configurable interview length.
- Major upgrades: Next 16, Clerk 7, `ai` 7, Mongoose 9.
- Turning on `tsconfig` `strict`.
- Integrating the sidecar.

---

## Review

### Step 1 — done (2026-09-24)
**What changed**
- **Deps:** removed 14 packages:
  - `freebuff`, `openai`, `@google/generative-ai`, `@ai-sdk/google`, `appwrite`, `ahooks`, `uuid`;
  - 7 unused `@types/*` packages.
- Bumped `next` to `^15.5.26` (already the latest 15.5 release) and `eslint-config-next` from `15.3.4` to `^15.5.26`.
- **Code:**
  - `crypto.randomUUID()` replaces `uuid` (`app/api/auth/guest/route.ts`);
  - `useUnmount` became a latest-ref `useEffect` cleanup (`components/interview.tsx`), keeping the original behaviour;
  - `getAllPrompts()` removed, and its doc snippet updated.
- **Deleted:** `lib/gemini.ts`, `lib/appwrite.ts`, `install.sh`, `install.sh.asc`.
- **Test pages:** moved to `app/(dev)/`, with `app/(dev)/layout.tsx` returning 404 in production. `test-speech` now uses `@/hooks/...` imports because its relative paths broke in the move.
- **Docs:** 12 notes moved to `docs/`. Links in README, `check-speech-api.sh` and `docs/FINAL_SUMMARY.md` updated.
- **Tooling:**
  - scripts: `lint` → `eslint .`, plus `typecheck` and `test`;
  - `eslint.config.mjs` ignores `.next/`, `out/`, `build/` and `next-env.d.ts` (without this, `eslint .` reported 12k errors after a build);
  - `.github/workflows/ci.yml` added.

**⚠ Real bug found and fixed while clearing the lint errors (`hooks/useFaceTracker.ts`)**
- The code passed `faceBlendshapes[0]` (a MediaPipe `Classifications` object) where an array was expected, hidden behind `as any`.
- `classifyEmotions` threw "not iterable" on **every frame where a face was detected**, and the silent `catch` dropped the frame.
- Result: face tracking only ever recorded "no face" frames. The stress HUD, the gaze alert and the report's face analytics were all dead.
- Now it passes `.categories`. I proved the throw and the fix by running the real function in Node.
- The `catch` now warns once, so a failure like this can't hide again.
- The other `any`s were removed; the types now line up without casts.

**Proof**
- Baseline before any change: `tsc` passed, `eslint .` had 6 errors (all in `useFaceTracker.ts`).
- `npm run lint` passes (checked again after a build). `npm run typecheck` passes. `npm test` passes (0 tests so far).
- `npm run build` passes (run with placeholder env vars inline, nothing written to disk).
- `npm audit`: **0 vulnerabilities**, down from 11 (2 critical).
- `npm ls` and `npm ci --dry-run` show the lockfile is in sync.
- `next start`: `/` 200, `/interview/new` 200, `/test-face` 404, `/test-speech` 404.
- `next dev`: `/test-face` 200.

**Notes and open risks**
- `/test-speech` gives a 404 in dev when signed out. That's Clerk's `protect-rewrite`: it was never in the middleware's public list, so this isn't new. It works once you're signed in.
- npm's allow-scripts policy skipped the install scripts for `@clerk/shared` and `unrs-resolver`. Lint and build work regardless. I didn't change your npm config.
- The Mongoose "duplicate index on guestId" warning is scheduled for Step 2.
- Face tracking now actually runs on real faces for the first time. The heuristics (stress, confidence and so on) have never processed live data, so expect them to need tuning. That's covered in Steps 4 and 5.
- Nothing committed.

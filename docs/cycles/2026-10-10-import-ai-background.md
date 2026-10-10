# Import in seconds, AI suggestions in the background

## Context
Production walk on 2026-10-10 (client Skypuats Industries, real BCA/BNI/Mandiri/SMBC statements, model
minimax-m3 — a reasoning model):

- **AI answers cut off.** Every import of 75–242 lines reported "AI gagal: Jawaban AI terpotong (batas 12000 / 9450
  / 9000 token)". BCA tahapan Jan: 167 of 188 lines fell back to a simple guess. Cause: a call asks about up to 40
  counterparties with an output cap of `min(12 000, 6 000 + 150·n)`; minimax-m3 spends most of that thinking before
  the JSON. And the loop stops at the first failure, so one cut-off batch leaves the whole rest of the file on
  simple guesses. A per-import cap of 3 calls (≤ 120 counterparties) also cuts larger files.
- **Imports take 20 s – 2 min.** The import request waits for up to 3 sequential AI calls (90 s timeout each)
  before it answers.
- **Results lost.** Twice (BCA pribadi Jan, then Feb as a deliberate reproduction) the import was written to the
  books but the browser received a non-RSC response (the network panel showed 503) — the page showed nothing or
  hard-navigated, and only a reload revealed the import. A user would upload the file again.
- **503s are tied to the long request, not load.** During a 100 s import, 90 parallel page fetches from the same tab
  all returned 200 in < 0.4 s; at idle, 12 parallel prefetches all 200. Vercel's Hobby logs record no 503 and no
  function error, so the platform cutoff itself is not visible — but every lost result was a long-running action.

Who feels it: the accountant on every import — they wait minutes, may lose the result, and then review hundreds of
lines with no useful suggestion.

## Decisions
1. **Import first, AI after.** The import books everything deterministically (transfers, rules, memory, financing
   text, simple guess → review lines on 1999, exactly as today) and answers in seconds. AI suggestions run after the
   response in the background; they only replace the suggestion of lines still in review (the existing *Minta saran
   AI* path). Nothing is posted from AI (invariant 4 unchanged).
2. **The user never waits or clicks to continue.** One "Saran AI" item shows progress where the user already looks
   (the import result and Review): "Saran AI diproses · 45 dari 150" → "Saran AI selesai · 132 saran" or the reason it
   stopped. Review lines update as answers arrive. Leaving the page doesn't stop it. (User: "async, user don't need to
   wait, one item processing where they can check".)
3. **Batches sized for reasoning models: 15 counterparties per call.** A cut-off call is retried once as two halves;
   then the run moves on to the next batch instead of stopping. Other failures (budget, auth, timeouts twice in a row)
   stop the run with a plain reason.
4. **Enough calls for the file, at most 20 per run** (~300 counterparties). The monthly token budget still caps
   spending; the cache still answers known counterparties for free.
5. **Background work is time-boxed.** A run works in slices that end well inside the platform limit; an unfinished run
   resumes automatically (the next slice is scheduled by the one before, and any page view of the client picks up a
   stalled run). No external queue, no new service.

## Acceptance criteria
- [ ] An import of a 200+ line statement answers in under ~15 s with its result (rows, booked, to review,
      continuity); no import response waits on an AI call.
- [ ] After that import, a "Saran AI" item appears on the result and on Review and moves to done without any click,
      also when the user navigates away and comes back.
- [ ] With a model that cuts off at the current sizes (simulated in tests), most lines still get an AI suggestion:
      one cut-off batch no longer stops the rest.
- [ ] A file with ~240 named counterparties gets suggestions for all of them (≤ 20 calls), cache hits cost nothing,
      and the monthly budget refusal still stops the run with its message.
- [ ] A line the accountant accepts while the run is going keeps the accountant's decision.
- [ ] Two runs never work on the same lines at once (a second import or *Minta saran AI* during a run joins or waits).
- [ ] *Minta saran AI* on Review uses the same background run (no long request there either).
- [ ] Tests and seed never call a real model (MockProvider + cache); `verify:books` ALL PASS; e2e green.
- [ ] Production check after merge: re-import walk shows results on the page every time and no 503 on the import.

## Verify flows
1. **Big statement, local** (Admin, MockProvider with a 2 s delay per call): import a 200+ line synthetic BCA file →
   result in seconds with "Saran AI diproses" → within a minute "Saran AI selesai", Review lines carry AI reasons.
2. **Leave and return:** start an import, go to Buku Besar, come back to Review → progress continued / finished.
3. **Edge — cut-off model:** MockProvider that returns `finish_reason: length` for batches > 8 → halves succeed,
   run finishes, note says how many stayed on simple guesses (if any).
4. **Error — budget exhausted:** monthly budget below one call → import still succeeds instantly; "Saran AI" item
   says the quota is used up, lines keep simple guesses, *Minta saran AI* stays available.

## UX notes
- Import result: the counts as today, plus one line "Saran AI · diproses 45 dari 150" with a small spinner; when done
  "Saran AI · 132 saran, 18 tetap tebakan sederhana"; when stopped, the reason in one sentence.
- Review: the same line above the queue while a run is active; lines refresh when the run finishes (no manual reload).
- No toast-only states; no "Lanjutkan" button.

## Test seams
- Unit: batch planner (15 per call, split-on-truncation once, continue on failure, 20-call cap, time box).
- DB integration: import returns before any provider call; background run fills suggestions; accepted line untouched;
  concurrent run guard; budget refusal; resume of a stalled run.
- e2e: import a statement → result immediately → "Saran AI selesai" appears without reload (MockProvider).

## Non-goals
- Changing what AI may suggest, the prompt wording, or the review/accept rules.
- Choosing a different production model (a Pengaturan decision for the firm).
- The upload-flow redesign (docs/cycles/2026-10-10-statement-drop.md) — it builds on this cycle.
- Moving PDF parsing or posting off the request (they take seconds).

## Assumptions
1. The background slice uses the request's own runtime after the response (no external queue); slices stay under
   ~4 minutes each so they end inside the current 300 s limit.
2. Progress lives in one small new table (run per client: status, totals, note, heartbeat) — additive migration.
3. Parallelism stays at one call at a time per run (credit protection and provider rate limits); speed comes from
   not blocking the user, not from fan-out.
4. Existing lines already on simple guesses from today's imports are picked up by *Minta saran AI* (now background),
   not automatically.
5. The 503s are not separately fixed at the platform level; removing long requests removes their trigger. If they
   recur on short requests after this ships, that is a new investigation.

## Gate re-openers
- **Schema migration (additive):** one table for AI run progress.
- **Sensitive path:** `app/actions.ts` (import and *Minta saran AI* actions change shape).
- **Paid AI use:** unchanged rules — no real calls in tests/seed; production spend still bounded by the monthly
  budget; per-run cap rises from 3 to 20 calls (approved above).
- No new dependency, no change to accounting invariants.

## Tasks
- [ ] T1 Batch planner — 15 per call, output cap sized for reasoning models, split once on truncation, continue on
      failure, 20-call cap — accept: unit tests with a truncating MockProvider. (reuse: `suggestWithAi`, `runBudgetedAi`)
- [ ] T2 AI run record + background runner — additive migration; start/resume/time-box/heartbeat; one run per client;
      writes suggestions only to lines still in review — accept: DB tests (fill, accepted line untouched, concurrent
      guard, budget stop, resume). (deps: T1; reuse: `suggestAgainWithAi`)
- [ ] T3 Import answers without AI — pipeline books deterministically, schedules the run after the response; *Minta
      saran AI* schedules a run too — accept: DB test that no provider call happens inside the import; demo seed and
      `verify:books` unchanged. (deps: T2)
- [ ] T4 Progress UI — "Saran AI" line on the import result and Review, auto-refresh until done — accept: verify flows
      1–4 locally. (deps: T3)
- [ ] T5 e2e + docs (README AI section, accounting-rules AI note) + full gate; production walk after merge recorded in
      Ship Notes — accept: full gate green.

## Implementation

## Verification

## Ship Notes

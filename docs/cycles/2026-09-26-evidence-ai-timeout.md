# 90-second AI timeout for evidence calls

## Context
On production (26 Sep 2026, 05:34 UTC) **Minta usulan konteks AI** on a bank-statement collection failed with
"AI gagal: The operation was aborted due to timeout". The key was valid and the request reached OpenCode Zen. It sent a
4,736-token prompt to `glm-5.3` with up to 2,000 output tokens, and Buku's fixed 30 s abort (`lib/ai/provider.ts:273`)
fired before the model answered. Evidence prompts are larger than the classification and mapping prompts the 30 s was
sized for. The user asked for 90 s on evidence calls.

Two facts shape the change:
- The server action may run 300 s (`app/(app)/layout.tsx` `maxDuration = 300`), so Vercel won't cut a 90 s call.
- The analysis step holds an intake lease of **90 s** (`claimStep`, `lib/evidence/store.ts:95`) while it calls AI, then
  `assertLease` before saving. With a 90 s AI timeout the lease could lapse mid-call: another step would take the intake
  and the paid answer would be discarded. That step's lease has to outlast the call.

## Spec
- [ ] `analyzeEvidence` (context proposals) and `planEvidenceAnswer` (question planning) abort after **90 s**;
      `classify` and `mapAccounts` keep **30 s**. One named constant per purpose in `lib/ai/provider.ts`.
- [ ] `claimStep()` takes an optional lease length. The analysis step (`lib/evidence/enrich.ts`) claims **150 s**
      (90 s call + margin for the budget reservation and saving facts). Every other step keeps 90 s.
- [ ] Timeout message stays as today. Reservation behaviour is unchanged: an interrupted call keeps its reservation (no retry loop).
- [ ] `docs/evidence-workspace.md` states the evidence AI timeout.

**Gate-reopeners:** none. No migration, dependency or env var. No change to token caps or AI payloads. No real AI calls in tests.

**Non-goals:** retries; streaming; making the timeout configurable; shortening prompts or changing `EVIDENCE_MAX_TOKENS`;
choosing another model.

**Assumptions:**
1. "Evidence calls" = the two provider methods above. Classification and account mapping stay at 30 s.
2. 150 s is enough lease for one 90 s call plus DB work, and a stuck analysis blocks other steps of that one intake for at
   most 150 s instead of 90 s.
3. Vercel's 300 s function limit (already in the layout) covers every path that reaches these calls (`/documents/**` server actions).

## Tasks
- [x] T1 Provider: per-call timeout in `complete()`; `EVIDENCE_TIMEOUT_MS = 90_000`, default 30 s — accept: unit test spies `AbortSignal.timeout` → 90 000 for `analyzeEvidence`/`planEvidenceAnswer`, 30 000 for `classify`/`mapAccounts`.
- [x] T2 Lease: `claimStep(db, firmId, intakeId, ms = 90_000)`; analysis claims 150 s — depends T1 — accept: DB test shows an analysis lease ≥ 150 s ahead and an inventory step lease still 90 s.
- [ ] T3 Docs + end-of-cycle gates (lint, typecheck, test, build, `verify:books`, `test:e2e`) — accept: all green.

## Implementation
- Plan: T1–T3 sequential, done inline (three small dependent edits).
- T1: `lib/ai/provider.ts` — `AI_TIMEOUT_MS = 30_000`, `EVIDENCE_TIMEOUT_MS = 90_000`; `complete()` takes the timeout; `analyzeEvidence`/`planEvidenceAnswer` pass 90 s. Test in `tests/unit/evidence-ai.test.ts`.
- T2: `lib/evidence/{store,enrich}.ts` — `claimStep(…, leaseMs = 90_000)`; analysis claims `EVIDENCE_TIMEOUT_MS + 60_000` (150 s). DB test in `tests/db/evidence-store.test.ts`.
## Verification
- T1: `AbortSignal.timeout` spy → [90000] for analyzeEvidence and planEvidenceAnswer, [30000] for classify and mapAccounts. Gate: lint ✔, typecheck ✔, `Test Files 44 passed (44) · Tests 349 passed (349)`.
- T2: during `analyzeEvidence` the lease is 145–150 s ahead; released afterwards; a plain `claimStep` stays ≤ 90 s. Gate: lint ✔, typecheck ✔, `Test Files 44 passed (44) · Tests 350 passed (350)`.
## Ship Notes

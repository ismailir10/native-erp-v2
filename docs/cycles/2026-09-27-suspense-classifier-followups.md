# 1999 corrections, loan lines, transfer window, evidence plan rejections

## Context
Four follow-ups left open by earlier cycles (close-you-can-trust non-goals, the real-file hard test):
1. **1999 differences.** An accepted unbalanced group from a ledger file posts its difference to 1999 ("Selisih dari file
   sumber"); the `ledger:` control stays FAIL until 1999 is cleared, and says "koreksi dengan Jurnal Penyesuaian" — the
   accountant has to work out which account and type the entry by hand.
2. **Loan lines.** With no rule, memory or AI answer, a bank line falls to a heuristic that calls money in *penjualan* (4100) and
   money out *beban umum* (6190). The hard test saw a Rp 300 jt loan drawdown in revenue and loan repayments in expenses; the
   sanity control now catches that afterwards, but the suggestion itself is wrong and costs an AI call first.
3. **Transfer matcher window.** Own-account transfers pair only within ±2 *calendar* days; a Friday transfer that lands on
   Tuesday (weekend, SKN clearing) stays unpaired in 1199.
4. **Evidence Q&A plan rejections.** A model's plan is thrown away for harmless slips (`"intent":"balance"`, 9 terms, an account
   code written "6180 Beban Penyusutan"), and a plan naming an entity outside the selected scope makes the whole question fail
   with an error. Nobody can see how often plans are rejected.

Approved in advance by the owner's request ("make sure these are done … finished until it merged to main").

## Spec
1999 corrections (`lib/adjust/suspense.ts`, reuses `ProposedEntry` from close-copilot)
- [x] For each ledger-import difference line on 1999 of an entity, dated in the period and not yet decided: a proposal
      (source `SUSPENSE`, key `SUSPENSE:<lineId>`) reversing it on 1999 against a counter account — prefilled when the same
      entry has exactly one other line of that very amount (the likely duplicated/missing line), else left for the accountant.
      Computed at read time; stored only when posted (→ POSTED) or dismissed (→ DISMISSED).
- [x] Shown in *Usulan jurnal koreksi* next to the AI drafts; the `ledger:` control detail points there.
- [x] Posting clears the entity's 1999 difference → the `ledger:` control's FAIL turns into PASS/REVIEW by itself.

Loan lines (`lib/classify/financing.ts`)
- [x] After rules and memory, **before AI**: financing text (same words as the sanity control) gets a deterministic suggestion —
      money in from a loan (PENCAIRAN / PINJAMAN / LOAN / PLAFON / PRK) → 2210 Utang Bank; money out repaying one
      (ANGSURAN / POKOK / PELUNASAN / PINJAMAN / LOAN) → 2210; interest on it (BUNGA / INTEREST) → 7110; bank fees on it
      (BIAYA / ADM / FEE / MATERAI / PROVISI) → 7100; capital paid in (SETORAN MODAL / MODAL) → 3100; an unpaired own-account move
      (PINDAH BUKU / OVERBOOK / ANTAR REKENING) → 1199. Method HEURISTIC (review, never auto-posts), confidence 0.5, reason
      says why. No AI call for these lines. Any other cost word on a loan line (PAJAK / TAX) gets no suggestion — never principal.

Transfer window (`lib/classify/transfer.ts`)
- [x] Pairs match within **2 business days** (Saturday/Sunday don't count) instead of 2 calendar days; the pipeline reads open
      counterparts ±6 calendar days. Nearest date still wins.

Evidence plans (`lib/ai/provider.ts`, `lib/evidence/answers.ts`)
- [x] Harmless slips are normalised, not rejected: intent case-insensitive, terms trimmed / over-long dropped / first 8 kept,
      an account code taken from its leading token ("6180 Beban Penyusutan" → 6180). Unknown keys, invalid dates and unknown
      intents are still rejected (deterministic fallback).
- [x] An entity in the plan that is outside the question's scope is **ignored with a limitation line**, never an error.
- [x] Plan calls are logged with note "Rencana jawaban" (success and failure alike); **Pengaturan** shows the last 30 days:
      plans requested, rejected, and the rate.

Verification
- [x] DB tests: 1999 proposal from an accepted unbalanced ledger group (counter account prefilled when unique; post → 1999 of
      the entity nets 0 and the control no longer FAILs; dismiss); pipeline suggests 2210/7110 for a loan statement with 0 AI
      calls; Friday→Tuesday pair matches, Monday→Friday doesn't; answer with an out-of-scope entity plan answers with a limitation;
      rejection counts.
- [x] Existing tests that relied on the old 4100 guess for "PENCAIRAN PINJAMAN" now set that wrong account explicitly (the controls
      still have to catch a human mistake).
- [x] Demo: `verify:books` ALL PASS; investor e2e unchanged.

**Gate-reopeners:** none — no migration (reuses `ProposedEntry`), no dependency. Classifier order is unchanged in rule 13's
sense (transfer → rules → memory → [financing heuristic] → AI → heuristic); the financing suggestion is a heuristic and never
auto-posts (rule 14). AI: fewer calls (financing lines skip AI).

**Non-goals:** 1999 lines from bank transactions (they are the review queue); proposals for other ledger checks; public-holiday
calendars for the transfer window; deposit placements (DEPOSITO/PENEMPATAN — no template account); changing what plan keys are
allowed.

**Assumptions:**
1. A ledger difference's counter account is only guessed when one line of the same entry has exactly that amount.
2. Business days = Monday–Friday; Indonesian public holidays are not modelled.
3. Financing words are the sanity control's words, so the suggestion and the control can't disagree.

## Tasks
- [x] T1 1999 correction proposals + card + control text + tests — accept: DB test green.
- [x] T2 Financing heuristic + business-day transfer window + tests (update tests that relied on the old guess) — accept: tests green; demo `verify:books` ALL PASS.
- [x] T3 Evidence plan normalisation, scope fix, rejection metric on Pengaturan + tests — accept: unit + DB tests green.
- [x] T4 Docs + end-of-cycle gates — accept: rules 13/15a, README; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline; branch stacked on `task/close-copilot` (1999 corrections reuse its `ProposedEntry`).
- T1: `lib/ledger-import/post.ts` exports `SOURCE_DIFFERENCE_MEMO` (the 1999 line's memo). `lib/adjust/suspense.ts` — `suspenseCorrections()` (1999 lines with that memo from a ledger import, dated in the period, without a *decided* proposal `SUSPENSE:<lineId>`; draft reverses the 1999 line; counter prefilled only when exactly one other line of the entry has that amount), `postSuspenseCorrection()` (1999 line fixed, counter required and not 1999; stores then posts through `postProposal`), `dismissSuspenseCorrection()`, `correctionViews()` (stored AI drafts + read-time 1999 corrections for the card). `lib/adjust/proposals.ts` — `proposalViews()` skips SUSPENSE rows (shown from their line, never twice). `app/actions.ts` routes `suspense:<lineId>` ids. `lib/controls/index.ts` — `ledger:` detail now says "koreksi lewat Usulan jurnal koreksi di Tutup Buku". Close page uses `correctionViews()`. Found by the test: a post that fails after storing (no counter / locked month) must not hide the line — only POSTED/DISMISSED decide it; an empty counter is refused before storing. Tests: `tests/db/suspense-corrections.test.ts`.
- T2: `lib/classify/financing.ts` — `FINANCING` / `FINANCING_COST` moved here (the sanity control re-exports them, so suggestion and control share one word list) and `financingSuggestion()`: interest → 7110, fees → 7100 (money out only), capital in → 3100, loan in → 2210, repayment out → 2210, own-account move → 1199; HEURISTIC 0.5, reason in Bahasa; deposits and income-side interest left alone. `lib/import/pipeline.ts` — accounts read before classification; the financing suggestion applies after transfer/rules/memory and only if its account is in the client chart; those lines skip AI. `lib/classify/transfer.ts` — `businessDaysApart()` and `MATCH_BUSINESS_DAYS = 2`; the pipeline reads open counterparts ±6 calendar days. Tests: `tests/unit/financing.test.ts`, `tests/db/financing-classify.test.ts` (loan statement → 2210 / 7110 / 2210 to review, 0 AI calls); `tests/db/sanity-controls.test.ts` and `tests/db/close-review.test.ts` now book the drawdown to 4100 explicitly (the controls still catch that human mistake; an accepted interest guess still needs its note).
- T3: `lib/ai/provider.ts` `parseEvidenceAnswerPlan` — intent upper-cased, terms trimmed / over-long and non-text dropped / first 8 kept, an account code taken from its leading token when that token has a digit ("6180 Beban Penyusutan" → 6180; "akun kas" still invalid); unknown keys, invalid dates, unknown intents still rejected (the pinned safety cases unchanged). `lib/evidence/answers.ts` — a planned entity outside the chosen scope is dropped with a limitation line (it used to throw and fail the question; the scope still can't widen); plan calls carry `note: PLAN_NOTE` ("Rencana jawaban"). `lib/ai/budget.ts` — a failed call's note keeps the caller's note as prefix ("Rencana jawaban — AI gagal: …"). `lib/evidence/plan-stats.ts` `planRejections()`; `app/(app)/settings/page.tsx` card *Rencana jawaban AI* (30 days: requested, rejected, %). Tests: `tests/unit/evidence-ai.test.ts` (normalisation), `tests/db/evidence-scope.test.ts` (out-of-scope entity → limitation; 2 plans, 1 rejected → 50 %), `tests/unit/evidence-answers.test.ts` (the override test now asserts the scope stays and the limitation shows, instead of a thrown error).
- Review fixes carried from PR #35 (merged before Codex's review landed): (1) a draft's bank line is matched only among the rows the answer **cites**, and two cited lines that both fit make the draft ambiguous — no proposal is stored (it could have re-coded the wrong twin); (2) AI drafts store a `snapshot` of the control's rows (`snapshotOf`, migration `20260927190000_proposal_snapshot`, one nullable column) and `postProposal` refuses when the control no longer flags the same rows ("Buku berubah sejak draf ini dibuat") — an old draft can't duplicate a fix made meanwhile; (3) a bank-line draft posts with the tax tag released (the approved full-amount lines are what posts), and the card says so. Test: `tests/db/close-explain.test.ts` "moves only the bank line the draft cites…" (fails on the previous code).
- T4: accounting-rules 13 (order with the financing suggestion, business-day window) and 15a (1999 correction proposals), README (Classify row, close row, Tanya Buku plan handling). Browser: Pengaturan shows *Rencana jawaban AI* ("Belum ada rencana jawaban AI dalam 30 hari terakhir." on the demo firm).
- Review fixes on PR #36: loan markers win over a bare MODAL ("PENCAIRAN PINJAMAN MODAL KERJA" → 2210, not 3100); an AI draft without a snapshot (made before the column existed) can't be proven fresh and is refused; a 1999 correction keeps the imported group's `ledgerImportId` and `sourceRef` (`postProposal` takes an `origin`), so its report impact still drills to the file's rows. Each has a test that fails on the previous code.
- Second review round on PR #36 (`@codex review` on 69e80d8): a 1999 correction can no longer be dismissed (it was the only way to clear that 1999 line — the free-form journal excludes suspense accounts — so dismissing it left the close stuck); the card hides *Abaikan* for them and the action refuses. `postProposal` now checks the AI draft's snapshot and writes in **one SERIALIZABLE transaction** (a concurrent fix either commits first and changes the snapshot, or makes this post fail with "coba catat lagi"); the bank-reclass path runs inside it. "PENCAIRAN / PELUNASAN KREDIT|KMK|KI" joined the shared financing words (suggestion and control), while a bare PELUNASAN (an invoice) or PENCAIRAN DEPOSITO stays out. Tests updated/added (financing phrases fail on the previous code).
- Third review round (85dd0a5): PROVISI joined the financing-cost words, so the classifier's own 7100 suggestion for "PROVISI PINJAMAN" isn't then flagged by the sanity control as financing in Laba Rugi; a unit test keeps every 7100/7110 financing suggestion inside the cost words (fails on the previous code).
- Fourth review round (609f11a): a tax on a loan ("PAJAK PINJAMAN") fell through to the principal pattern and got 2210, which would understate the loan and escape the control (PAJAK is a cost word); any cost word that isn't interest or a fee now makes the classifier step aside (rules, memory or AI decide). Unit test fails on the previous code.
- Fifth review round (417dfaa): the draft's fingerprint left out the cited bank line's tax tag, so a reviewer changing only the PPN tag after the draft was made kept it "fresh", and posting would silently drop the new tag. The snapshot now also covers the moved line's account and tax tag (`bankLineState` in `lib/controls/ai-review.ts`); any re-review of that line makes the draft stale. Test in `tests/db/close-explain.test.ts` fails on the previous code.

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 59 passed (59), Tests 418 passed (418).
- T2: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 423 passed (423); `demo:reset` (same AI call pattern per file) + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
- T3: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 425 passed (425).
- PR #35 review fixes: new case fails on the previous code (1 failed | 3 passed), passes after; local DBs migrated, `prisma migrate diff` → empty; lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 426 passed (426).
- End of cycle: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 426 passed (426); `npm run build` ✓ Compiled successfully; `npm run demo:reset && npm run verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.; `npm run test:e2e` → 10 passed (1.3m); with `EVIDENCE_ENABLED=true` → 10 passed (1.1m).
- PR #36 review fixes: the three new cases fail on the previous code (3 failed | 8 passed) and pass after; lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 427 passed (427); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.; `npm run test:e2e` → 10 passed (55.0s).
- PR #36 second review round: new financing cases fail on the previous code (2 failed | 2 passed) and pass after; lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 427 passed (427); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.; `npm run test:e2e` → 10 passed (56.3s).
- PR #36 third review round: new consistency test fails on the previous code (1 failed | 4 passed) and passes after; lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 428 passed (428); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.; `npm run test:e2e` → 10 passed (53.9s).
- Fourth review round: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 429 passed (429); `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
- Fifth review round: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 430 passed (430); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (54.3s).

## Ship Notes
- **Migration** `20260927190000_proposal_snapshot`: one nullable column `ProposedEntry.snapshot`. Additive; applied by `vercel-build`.
- **Behaviour changes:** loan / capital / own-account lines are suggested to the balance sheet (still reviewed) and skip AI; own-account transfers pair across weekends (2 business days); ledger-file differences on 1999 get correction proposals in *Usulan jurnal koreksi*; evidence questions no longer fail when the AI plan names another entity; Pengaturan shows the plan-rejection rate. AI drafts from *Jelaskan* now refuse to post once the books changed, and move only the cited bank line (fixes from the PR #35 review).
- No env var, no dependency. Rollback: revert the merge; the migration is additive.

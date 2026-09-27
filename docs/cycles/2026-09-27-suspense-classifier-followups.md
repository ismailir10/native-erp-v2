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
      says why. No AI call for these lines.

Transfer window (`lib/classify/transfer.ts`)
- [x] Pairs match within **2 business days** (Saturday/Sunday don't count) instead of 2 calendar days; the pipeline reads open
      counterparts ±6 calendar days. Nearest date still wins.

Evidence plans (`lib/ai/provider.ts`, `lib/evidence/answers.ts`)
- [ ] Harmless slips are normalised, not rejected: intent case-insensitive, terms trimmed / over-long dropped / first 8 kept,
      an account code taken from its leading token ("6180 Beban Penyusutan" → 6180). Unknown keys, invalid dates and unknown
      intents are still rejected (deterministic fallback).
- [ ] An entity in the plan that is outside the question's scope is **ignored with a limitation line**, never an error.
- [ ] Plan calls are logged with note "Rencana jawaban" (success and failure alike); **Pengaturan** shows the last 30 days:
      plans requested, rejected, and the rate.

Verification
- [ ] DB tests: 1999 proposal from an accepted unbalanced ledger group (counter account prefilled when unique; post → 1999 of
      the entity nets 0 and the control no longer FAILs; dismiss); pipeline suggests 2210/7110 for a loan statement with 0 AI
      calls; Friday→Tuesday pair matches, Monday→Friday doesn't; answer with an out-of-scope entity plan answers with a limitation;
      rejection counts.
- [x] Existing tests that relied on the old 4100 guess for "PENCAIRAN PINJAMAN" now set that wrong account explicitly (the controls
      still have to catch a human mistake).
- [ ] Demo: `verify:books` ALL PASS; investor e2e unchanged.

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
- [ ] T3 Evidence plan normalisation, scope fix, rejection metric on Pengaturan + tests — accept: unit + DB tests green.
- [ ] T4 Docs + end-of-cycle gates — accept: rules 13/15a, README; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline; branch stacked on `task/close-copilot` (1999 corrections reuse its `ProposedEntry`).
- T1: `lib/ledger-import/post.ts` exports `SOURCE_DIFFERENCE_MEMO` (the 1999 line's memo). `lib/adjust/suspense.ts` — `suspenseCorrections()` (1999 lines with that memo from a ledger import, dated in the period, without a *decided* proposal `SUSPENSE:<lineId>`; draft reverses the 1999 line; counter prefilled only when exactly one other line of the entry has that amount), `postSuspenseCorrection()` (1999 line fixed, counter required and not 1999; stores then posts through `postProposal`), `dismissSuspenseCorrection()`, `correctionViews()` (stored AI drafts + read-time 1999 corrections for the card). `lib/adjust/proposals.ts` — `proposalViews()` skips SUSPENSE rows (shown from their line, never twice). `app/actions.ts` routes `suspense:<lineId>` ids. `lib/controls/index.ts` — `ledger:` detail now says "koreksi lewat Usulan jurnal koreksi di Tutup Buku". Close page uses `correctionViews()`. Found by the test: a post that fails after storing (no counter / locked month) must not hide the line — only POSTED/DISMISSED decide it; an empty counter is refused before storing. Tests: `tests/db/suspense-corrections.test.ts`.
- T2: `lib/classify/financing.ts` — `FINANCING` / `FINANCING_COST` moved here (the sanity control re-exports them, so suggestion and control share one word list) and `financingSuggestion()`: interest → 7110, fees → 7100 (money out only), capital in → 3100, loan in → 2210, repayment out → 2210, own-account move → 1199; HEURISTIC 0.5, reason in Bahasa; deposits and income-side interest left alone. `lib/import/pipeline.ts` — accounts read before classification; the financing suggestion applies after transfer/rules/memory and only if its account is in the client chart; those lines skip AI. `lib/classify/transfer.ts` — `businessDaysApart()` and `MATCH_BUSINESS_DAYS = 2`; the pipeline reads open counterparts ±6 calendar days. Tests: `tests/unit/financing.test.ts`, `tests/db/financing-classify.test.ts` (loan statement → 2210 / 7110 / 2210 to review, 0 AI calls); `tests/db/sanity-controls.test.ts` and `tests/db/close-review.test.ts` now book the drawdown to 4100 explicitly (the controls still catch that human mistake; an accepted interest guess still needs its note).

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 59 passed (59), Tests 418 passed (418).
- T2: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 423 passed (423); `demo:reset` (same AI call pattern per file) + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.

## Ship Notes

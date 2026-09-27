# GL anomaly + flux review — the close looks at the ledger, not only the bank

## Context
Close controls prove arithmetic (TB, A = L + E, bank recon, 1199/1999/1190) and, since ADR 0009, a few sanity checks.
Those sanity checks are mostly **bank-row** checks (financing text in the P&L, accepted guesses), so a client whose books
come in as a **ledger file** (Chickin: 707 client accounts, 5 entities; Goers) passes the close without anything looking at
the ledger itself. A double-posted invoice, a revenue account that ran debit this month, an expense line that tripled, or
an account that wakes up after a year all close green today.

What an accountant (and an auditor) does by hand at month-end is exactly this: flux review (this month vs the usual) and a
scan for anomalies, then a one-line explanation per item. Rillet-style: the ledger is the system of record and the close
watches it.

Who feels it: the accountant closing a ledger-fed client, and the partner signing it off. Outcome: four deterministic
scans run with the other controls, flag REVIEW with the accounts and amounts behind them, open into the ledger, and the
existing AI close review explains each one with citations. Nothing changes how anything posts.

## Spec
Scans (`lib/controls/anomaly.ts`, per entity, deterministic — AI never decides, rule 22a spirit). Movement = Σdebit − Σcredit
of the month, read on the account's normal side; **OPENING entries never count as movement**. Baseline = the **3 calendar
months before** the period, counting only months in which the entity has any non-opening line.
Materiality **M** per entity-month = **1 % of the baseline's average monthly P&L volume** (Σ over P&L accounts of |movement|);
no baseline month → the scans that need one are skipped.
- [x] **Flux** `flux:<entity>` — P&L accounts (7190/7200 exempt) whose month movement differs from the baseline average by
      ≥ M **and** ≥ 50 % of |average|. Needs ≥ 2 baseline months. REVIEW, detail lists the top 5 by |Δ|:
      `6110 Beban Gaji Rp 45.000.000 vs rata-rata 3 bln Rp 20.000.000 (+125%)`.
- [x] **Sign against nature** `flip:<entity>` — P&L accounts whose month movement runs against their `normalBalance`
      (revenue net debit, expense net credit), |movement| ≥ M; 7190/7200 exempt. (Balance-sheet accounts are already
      covered by `nature`.) REVIEW.
- [x] **New / reactivated account** `dormant:<entity>` — |movement| ≥ M on an account that had no movement in the 3 prior
      calendar months (all 3 must have entity activity), either never before (*akun baru*) or with earlier movement
      (*aktif lagi*). Bank, suspense, clearing, intercompany, 7190/7200 exempt. REVIEW.
- [x] **Possible duplicate** `dup:<entity>` — two entries of the period (the second may look back 3 days) with the same
      line signature (account, debit, credit per line) and dates ≤ 3 days apart, amount ≥ M. Two **bank-derived** entries
      never pair (the statement's running balance proves each row happened); two lines of **the same ledger file** pair only
      when their memos match too. OPENING and RECLASS never pair. REVIEW, top 5 pairs with dates, amounts and sources.
- [x] Each scan emits a row only when it flags; `sanity:<entity>` PASS text extends to say the ledger scans found nothing.
      Controls follow `runControls`' shape (key, title, scope, detail, href to the account's ledger for the period, ack).

AI close review (ADR 0009, extended, not a new path)
- [ ] `gather()` sends the rows behind each new control: per flagged account a summary row (`akun:<entity>:<code>` —
      baseline months and this month) and the largest lines of the month on it (`jl:<lineId>`: date, memo ≤ 80 chars,
      amount, account, entry kind + `sourceRef`); for `dup`, both entries of each pair (`je:<entryId>`). Same caps: ≤ 10 rows
      per control, ≤ 40 in total. Links open the account ledger for the period.
- [ ] Prompt names the four scans and what a good answer looks like (seasonal / one-off with evidence, reclass, reversing
      adjustment, ask for the document); `CLOSE_REVIEW_PROMPT_VERSION` → `close-review-v2` (old cache entries simply miss).
- [ ] ADR 0009 amendment + accounting-rules **22b**: the scans, the thresholds, and that journal memos (≤ 80 chars) of
      lines behind flagged anomaly controls may be sent, under the same caps and budget.

Verification
- [x] `tests/db/anomaly-controls.test.ts`: each scan flags its planted case and ignores the look-alike (bank pair,
      same-file different memo, below M, 7190, OPENING, < 2 baseline months, contra account on its normal side); a period
      with a flagged scan can lock only after a note; `runControls` output for a clean entity unchanged apart from the
      PASS text.
- [ ] `tests/db/close-review.test.ts`: MockProvider review of a flux + dup case returns items citing `akun:`/`jl:`/`je:`
      ids; ids it wasn't given are dropped; cache hit on second call (0 extra `AiUsage`).
- [ ] Demo: `demo:reset && verify:books` ALL PASS (no number changes). The investor walk expects August to close with
      no "Perlu dicek"; if a scan flags on the synthetic August it is inspected — a genuine scenario pattern is acknowledged
      in the walk with a note (script + `docs/demo/investor-demo.md` updated), never hidden by tuning a threshold to the demo.
- [ ] `scripts/verify-real.ts` prints per client the anomaly flags of the last month of each file (counts + top lines),
      so the noise level on Chickin/Goers is visible locally.

**Gate-reopeners:** no schema migration, no dependency. **AI payload scope extended** (ADR 0009 amendment: journal memos
of rows behind the new controls, same ≤ 40-row / ≤ 80-char caps, same budget and cache; tests use MockProvider only).
No change to posting or any other accounting invariant; the new controls are REVIEW only — they never FAIL.

**Non-goals:** balance-sheet flux; year-over-year comparison; configurable thresholds per client; storing scan results
(computed at read time like every control); a new page for flux (the control links into the ledger); AI deciding or
auto-acknowledging a flag; proposed adjusting entries (C4); "Jelaskan" per control (the review card already explains all
flagged controls in one call).

**Assumptions:**
1. REVIEW (needs a note), never FAIL: an unusual month is often legitimate.
2. Thresholds are fixed constants (1 % volume materiality, 50 % flux, 3-month baseline, 3-day duplicate window), documented
   in rule 22b; tuning waits for real-data evidence from `verify-real`.
3. Bank-derived pairs are never duplicates (continuity proves them); a double entry between a bank line and a manual
   adjustment or a ledger line is exactly what the scan is for.
4. Real-data runs (`verify-real`) happen on the owner's machine; this cycle's evidence is tests + demo.

## Tasks
- [x] T1 `lib/controls/anomaly.ts` scans + wiring into `runControls` + DB tests — accept: `tests/db/anomaly-controls.test.ts` green; demo August inspected (`demo:reset`, controls listed). Reuse `periodBounds`, `formatMoney`, `Control`, sanity's `control()` shape.
- [ ] T2 AI review rows + prompt v2 + tests — accept: `tests/db/close-review.test.ts` new cases green with MockProvider. Depends T1. Reuse `gather()`'s `take`/`bySize`/`links`.
- [ ] T3 Docs + real-data report: ADR 0009 amendment, accounting-rules 22b, `verify-real` anomaly section, demo walk/doc if T1 found a flag — accept: typecheck; e2e green.
- [ ] T4 End-of-cycle gates — accept: `build`, `demo:reset`, `verify:books` ALL PASS, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline (each task builds on the previous one's control keys; small enough to review as one diff).
- T1: `lib/controls/anomaly.ts` — `scanLedger()` (per account natural movement per month via `groupBy`, OPENING excluded; baseline = active months among the 3 before; materiality 1 % of the baseline's average P&L volume; flux / flip / dormant / dup findings, shared with the AI review in T2) and `anomalyControls()` (REVIEW rows `flux:` `flip:` `dormant:` `dup:` with top-5 details and a ledger link for the period). *Akun baru* = nothing on the account before the period at all; an opening balance or older movement reads *bergerak lagi setelah ≥ 3 bulan diam*. `lib/controls/index.ts` runs it after the sanity checks; the entity's single PASS row (`sanity:`) moved from `sanity.ts` to `runControls` and now also names the ledger scans. Tests: `tests/db/anomaly-controls.test.ts` (clean month, flux vs small-amount look-alike, < 2 baseline months, flip vs 7190, new vs opening-balance account vs below materiality, duplicates vs bank pair / 19 days apart / same file different memo, lock blocked by the unacknowledged duplicate only).
- Demo inspection (`demo:reset`, controls May–Aug 2026 for every client): one flag — PT Jasa Kreatif Juli `flux` 6170 Rp 17.450.000 vs rata-rata Rp 11.466.666 (+52%), a closed month the seed acknowledges. Ayam August is clean as seeded, but the walk's review books the planted *mesin pakan* (Rp 185.000.000) to 1210 Aset Tetap, which only had an opening balance, so `dormant` should flag it after the review step — a genuine capex signal; confirmed and handled in the walk in T3.

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 53 passed (53), Tests 392 passed (392).

## Ship Notes

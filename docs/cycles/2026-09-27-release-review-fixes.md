# Release review fixes (staging → main)

## Context
The review of the staging → main promotion (PR #37) found two defects in code already on staging, in the close copilot (#35) and the
anomaly scans (#33). Both can put a wrong number in front of the accountant at the close, so they ship before the release merges.

## Spec
- [x] An AI draft's amounts are grounded only in rows the answer **cites**; an amount copied from an uncited row (or no row cited)
      drops the draft and keeps the explanation (accounting-rules 20b).
- [x] Flux needs the **account itself** to have moved in ≥ 2 baseline months; an account seen once is not compared against a
      zero-padded average (accounting-rules 22b).

**Non-goals:** any other change to the promotion; the baseline window or thresholds.
**Assumptions:** the average stays over the entity's active baseline months (a month the account didn't move counts as 0), only
the minimum number of the account's own observations changes.

## Tasks
- [x] T1 Ground draft amounts in cited rows + require two own baseline months for flux — accept: new tests fail on the old code

## Implementation
- T1: `lib/ai/provider.ts` — `groundedEntry` builds its allowed amounts from the rows whose ids survived reference validation.
  `lib/controls/anomaly.ts` — flux runs only when `history` has ≥ 2 defined values. Tests: `tests/unit/close-explain.test.ts`
  (amount from an uncited row, no refs), `tests/db/anomaly-controls.test.ts` (account moved once in an active baseline). Rules 20b/22b
  wording in `accounting-rules`.

## Verification
- T1: new tests fail on the previous code (2 failed | 9 passed), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 431 passed (431); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (55.5s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

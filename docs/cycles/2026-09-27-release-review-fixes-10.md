# Release review fixes 10

## Context
The review of the staging → main promotion (#37, head e41a53f) found two more gaps:
1. **Schedule candidates from compound entries.** Creating a schedule from one line of an entry hid every other line of that entry
   from later candidate scans. The entry-level `schedulesFrom: none` filter did this. The second fixed asset of a two-asset
   purchase, or the fixed asset next to a prepayment, was never proposed.
2. **Client-account TB rows posted to several Buku accounts.** `sourceTrialBalance()` merged the groups of such an account but took
   the type and account from whichever `groupBy` group came first. The order is unspecified, so the same balance could land in
   different sections. The linked ledger meanwhile reads by a fixed posted basis (fixes 7).

## Spec
- [x] A schedule made from an entry covers only the line it came from (accounting-rules 5a):
  - Prepaid and deferred-revenue schedules match by the account they name.
  - A depreciation schedule (6180/1219, no asset account) covers the asset line of its amount. Once the entry has as many
    depreciation schedules as asset lines, all of them are covered, so edited amounts still count.
- [x] A client-account TB row takes its type and Buku account from the same posted basis as its ledger: the earliest posted account
      of the file's type, else the earliest posted (rule 9a).

**Non-goals:** storing a schedule's source line (a schema change).
**Assumptions:** a depreciation schedule whose amount was edited and that isn't the last one for the entry may leave one extra
suggestion visible. That is harmless: it is only a suggestion.

## Tasks
- [x] T1 Candidates: a schedule covers only its own line — accept: new test fails on the old scan
- [x] T2 Source TB rows use the posted basis — accept: new test fails on the old aggregation

## Implementation
- T1: `lib/adjust/candidates.ts` drops the entry-level filter and adds `covered(line, net)`, based on the entry's schedules.
  Test in `tests/db/schedule-candidates.test.ts`:
  - A machine + car purchase, and a rent + rack invoice.
  - After depreciating the machine and amortising the rent, the car and the rack stay proposed.
  - A second depreciation with an edited amount covers the purchase.
- T2: `lib/reports/account-ledger.ts` exports `postedBasis`, shared with `sourceLedgerBasis`. `lib/reports/source.ts` applies it to
  rows of client accounts posted to more than one Buku account. Test in `tests/db/client-coa.test.ts`: two client accounts posted
  to 2110 / 1110 in opposite orders present as 2110 LIABILITAS and 1110 ASET.
  Rules 5a and 9a wording updated.

## Verification
- T1: the new test fails on the old scan ("expected [] to deeply equal [ 'DEPRECIATION:buy:30000000', …"; the car and rack
  disappeared) and passes after.
- T2: the new test fails on the old aggregation ("expected [ '2110', 'LIABILITAS', 30n ] to deeply equal [ '1110', 'ASET', 30n ]";
  both rows took the same first group) and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 457 passed (457).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.3s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

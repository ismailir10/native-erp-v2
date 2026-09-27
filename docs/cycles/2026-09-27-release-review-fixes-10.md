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

- [x] Review round 2 (#47):
  - Depreciation schedules match asset lines one to one, so two lines of the same amount each need their own schedule.
  - The posted basis of a TB row only looks at lines up to the report date. A later posting to another account can't break an
    earlier report.

- [x] Review round 3 (#47): the client-account ledger's basis takes the report's period end too. The TB row and the ledger it drills
      to always read by the same posted account.

**Non-goals:** storing a schedule's source line (a schema change).
**Assumptions:** a depreciation schedule whose amount was edited and that isn't the last one for the entry may leave one extra
suggestion visible. That is harmless: it is only a suggestion.

## Tasks
- [x] T1 Candidates: a schedule covers only its own line — accept: new test fails on the old scan
- [x] T2 Source TB rows use the posted basis — accept: new test fails on the old aggregation
- [x] T3 One-to-one depreciation matching; as-of horizon for the TB basis — accept: both new cases fail on the previous commit
- [x] T4 The ledger basis uses the same report cutoff — accept: new case fails on the previous helper

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
- T3:
  - `lib/adjust/candidates.ts` precomputes the covered asset lines per entry. Each amount match consumes one schedule; with at
    least as many schedules as asset lines, all are covered.
  - `lib/reports/source.ts` adds `date: { lte: asOf }` to the basis query and skips an account it didn't load.
  - Tests: two 15 jt printers on one entry, where one schedule leaves one candidate; and a February posting to 6180 on a client
    account whose January TB is asked.
- T4: `sourceLedgerBasis(db, src, asOf?)` limits the posted lines to `asOf`, and the client-account ledger page passes `period.end`.
  The test uses a client account typed ASET in its file, posted to 2110 up to January and to 1110 in February. Its January TB row and
  January ledger both read 2110 (CREDIT). From February on, the ledger reads 1110.

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
- T3: both new cases fail on the previous commit (candidates: "expected +0 to be 1", both printers hidden; TB: "TypeError: Cannot
  read properties of undefined (reading 'type')") and pass after.
- T3 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 457 passed (457).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.7s).
- T4: the new case fails on the previous helper ("expected { normalBalance: 'DEBIT', isPL: false } …": it read the later 1110) and
  passes after.
- T4 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 457 passed (457).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.7s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

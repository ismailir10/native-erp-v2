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

- [x] Review round 4 (#47): the ledger's opening follows each posted line's own account, as the TBs do. Income and expense lines
      count from 1 January; balance-sheet lines count from the start. A client account posted to both kinds therefore closes its
      ledger at its TB row. The posted basis now only chooses the normal side shown.

- [x] Review round 5 (#47): among asset lines of equal amount, a schedule takes the line whose account name its memo carries. A
      schedule made from a candidate keeps "Penyusutan <account> <date>", so the right line is covered. The first line is the
      fallback when the memo was edited.

- [x] Review round 6 (#47): a candidate depreciation memo leads with the account code ("Penyusutan 1210 Aset Tetap 19 Agu 2026").
      The code survives the 80-character cut. Matching tries the code first, then the name (older memos), then the first line.

- [x] Review round 7 (#47): a depreciation schedule hides only the asset line it identifies. The matcher tries the account code in
      its memo, then the account name, then the exact amount. The "as many schedules as asset lines" shortcut is gone: with the code
      in every candidate memo it is no longer needed, and a prepayment candidate turned into a depreciation no longer hides a real
      asset. Changing the kind in the schedule dialog also drops the candidate's source entry.

- [x] Review round 8 (#47): the schedule form remembers where it was opened from. Switching the kind away from the candidate's
      drops the source entry, and switching back restores it. A schedule identical to its candidate always cites the entry, so
      the candidate can't be offered twice.

- [x] Review round 9 (#47): one rule decides at save time whether a schedule cites its candidate's entry. It does only while it
      still identifies that line: same kind and entity, and either the amortised account (prepaid credit or deferred-revenue debit)
      or, for a depreciation, the asset's code in the memo. Editing the entity, the account or the memo drops the citation, so the
      candidate stays proposed rather than being cited by a schedule that doesn't cover it.

- [x] Review round 10 (#47): the account must stay on the side it amortises on. A prepayment is credited and deferred revenue is
      debited. Both the candidate matcher and the form rule check the side, so a schedule that would grow the balance neither
      hides the candidate nor cites its entry.

- [x] Review round 11 (#47): an entry with a single asset line needs no memo match. An older depreciation schedule that cites it,
      with a custom memo and an adjusted amount, still covers that line, unless the schedule identifies another line of the entry
      by amount, account code or account name.

- [x] Review round 12 (#47): schedules are matched to lines one to one for every kind. A schedule that credits a prepayment and
      debits deferred revenue covers one of the two, the one its memo (then amount) names. A depreciation whose amount points at
      another line of the entry no longer consumes an asset line of the same amount.

- [x] Review round 13 (#47): schedules that name their line's account are matched first. A depreciation's amount then collides
      only with lines still open; a memo naming another line still points away.

- [x] Schema change, approved by the user on 2026-09-28 ("do the schema change, approved, build and ship it"). A schedule stores
      its source line: `AdjustmentSchedule.sourceAccountId`, with `sourceEntryId`, plus a DB CHECK that the account never stands
      without the entry. `createSchedule` accepts `sourceAccountCode` only when the entry has a line on that account and the
      schedule releases it: an asset by depreciation, a prepayment on the credit side, deferred revenue on the debit side. A
      schedule that stores its line covers exactly that line. The memo and amount matching remains only for schedules made
      before the line was stored.

**Non-goals:** backfilling `sourceAccountId` on existing schedules. Older schedules keep the one-to-one memo and amount matching.
**Assumptions:** the schedule form records the line only while the schedule still releases it (same kind and entity, account on
its side). A depreciation keeps its line whatever its memo.

## Tasks
- [x] T1 Candidates: a schedule covers only its own line — accept: new test fails on the old scan
- [x] T2 Source TB rows use the posted basis — accept: new test fails on the old aggregation
- [x] T3 One-to-one depreciation matching; as-of horizon for the TB basis — accept: both new cases fail on the previous commit
- [x] T4 The ledger basis uses the same report cutoff — accept: new case fails on the previous helper
- [x] T5 The ledger opening follows each line's own account — accept: new case fails on the previous ledger
- [x] T6 Equal-amount asset lines matched by the schedule's memo — accept: new case fails on the previous matching
- [x] T7 The memo carries the account code, matched first — accept: the truncated-name case fails on the previous commit
- [x] T8 CI pins the Supabase CLI — accept: the setup step no longer resolves "latest" through the GitHub API
- [x] T9 A schedule hides only the asset line it identifies — accept: the converted-prepayment case fails on the previous matcher
- [x] T10 The form restores the candidate's source on returning to its kind — accept: unit test of `sourceForKind`
- [x] T11 One save-time rule for citing a candidate's entry — accept: unit test covers kind, entity, account and memo edits
- [x] T12 The amortised account must stay on its side — accept: both new checks fail on the previous code
- [x] T13 A schedule citing a single-asset entry covers that asset — accept: the legacy-schedule case fails on the previous matcher
- [x] T14 One line per schedule for every kind; no amount match that points elsewhere — accept: both new cases fail on the previous matcher
- [x] T15 Amount collisions only with open lines, whatever the creation order — accept: the new case fails on the previous matcher
- [x] T16 Store the schedule's source line (schema) — accept: the equal-amount twin with an edited memo fails on the previous matcher
- [x] T17 Older schedules: collisions only with candidate-direction lines — accept: the reclassed-prepayment case fails on the previous matcher

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
- T5:
  - `lib/reports/account-ledger.ts` `accountLedger` drops its `isPL` argument. The opening sums balance-sheet lines before the
    start, plus income and expense lines from 1 January. For a Buku account this changes nothing, since it has a single type.
  - The two ledger pages and tests no longer pass `isPL`.
  - Test: a client account posted to 1110 in November, 6180 in December and 1110 in January. Its TB row and ledger both open at
    10 and close at 30.
- T6: `lib/adjust/candidates.ts` matches each schedule to an open asset line of its amount. It prefers the line whose account name
  appears in the memo, longest name first. Test: two 15 jt printers (1210 Aset Tetap, 1211 Kendaraan). Scheduling the second
  candidate leaves "Penyusutan Aset Tetap …".
- T7: `lib/adjust/candidates.ts` uses the memo `Penyusutan <code> <account> <date>` and matches on the code as a whole word.
  - Test: the second printer's account name is long, so its memo is cut to 80 characters but still starts "Penyusutan 1212 ".
    Scheduling it leaves "Penyusutan 1210 Aset Tetap …".
  - `e2e/investor-demo.spec.ts` expects the new memo text.
- T8: CI on f641073 passed all 458 tests, then failed in `supabase/setup-cli` with "Failed to resolve latest Supabase CLI release:
  rate limit exceeded", before e2e ran. The job couldn't be re-run from here (403). `.github/workflows/ci.yml` now pins
  `version: 2.118.0`, the CLI the local e2e runs use, so setup downloads that release directly.
- T9:
  - `lib/adjust/candidates.ts` matches in this order: code, then name (with an equal amount first), then exact amount. A schedule
    that identifies nothing hides nothing, so at worst a suggestion stays visible.
  - `components/app/schedule-panel.tsx` clears `sourceEntryId` when the kind changes.
  - Test: the edited-amount car schedule carries "1211". A prepayment turned into a depreciation (12 jt, prepaid memo) leaves the
    20 jt rack proposed.
- T10: `lib/adjust/form.ts` adds `sourceForKind(origin, kind)`. `components/app/schedule-panel.tsx` keeps `origin` (the candidate's kind
  and entry) and uses it on every kind change. Test: `tests/unit/schedule-form.test.ts`. The previous handler kept the source only
  when the kind was unchanged, so switching away and back lost it; the helper is new, so the test pins the new rule rather than
  failing on old code.
- T11: `lib/adjust/form.ts` replaces `sourceForKind` with `originOf(candidate)` and `sourceFor(origin, form)`.
  `components/app/schedule-panel.tsx` no longer tracks `sourceEntryId` per change; it computes it when saving. Test:
  `tests/unit/schedule-form.test.ts`, covering another kind, another entity, the amortised account edited away and back, a
  depreciation memo without the code, and a blank form.
- T12:
  - `lib/adjust/candidates.ts` `covered` matches prepaid lines by the schedule's credit account and deferred-revenue lines by its
    debit account.
  - `lib/adjust/form.ts` gives `FormOrigin` a `side`, derived from the candidate; `sourceFor` checks that side.
  - Tests:
    - A 1170-on-debit schedule leaves the rent candidate proposed.
    - The unit test covers a prepaid account moved to debit and a deferred-revenue account moved to credit.
- T13: `lib/adjust/candidates.ts` adds a last fallback. When code, name and exact amount all miss, and the entry has exactly one
  asset line still open, the schedule covers it. This does not apply when the schedule's amount, code or name points at another
  line of the entry, which keeps the converted-prepayment case from T9 proposed. Test: a 48 jt machine with a schedule memo
  "Susut mesin pakan (nilai sisa 8 jt)" and an amount of 40 jt leaves no candidate for that entry.
- T14: `lib/adjust/candidates.ts` replaces `coveredAssets` and the `covered` predicate with one `coveredLines` pass per entry.
  - Every schedule citing the entry, in creation order, takes at most one open line. For prepaid and deferred-revenue lines the
    account has to be on the releasing side; the memo, then the amount, picks between two fitting lines.
  - A depreciation's amount match (and the sole-asset fallback) applies only when the schedule points at no other line of the
    entry.
  - Tests:
    - An entry with 1170 12 jt and 2160 6 jt. A schedule credits 1170 and debits 2160, with the prepaid memo. The deferred-revenue
      candidate stays proposed.
    - An entry with 1170 20 jt and 1210 20 jt. A depreciation carries the prepaid memo and 20 jt. Both candidates stay proposed.
- T15: `lib/adjust/candidates.ts` handles the schedules citing an entry in two passes. The non-depreciation schedules go first,
  since their account identifies the line; the depreciations follow. In `elsewhere`, an equal amount counts only against a line
  that is still open, while a memo naming another line still counts. Test: two entries, each with 1170 20 jt and 1210 20 jt. Each
  gets an amortisation and an older-style depreciation ("Susut rak gudang", 20 jt), created in opposite orders. No candidate
  remains for either entry.
- T16:
  - `prisma/schema.prisma` and migration `20260928010000_schedule_source_line` add `sourceAccountId`: a foreign key to Account,
    `ON DELETE SET NULL` like `sourceEntryId`, plus the CHECK `AdjustmentSchedule_source_line_check`.
  - `lib/adjust/schedules.ts`: `createSchedule` validates and stores `sourceAccountCode`.
  - `lib/adjust/form.ts`: `sourceFor` returns `{ sourceEntryId, sourceAccountCode }`. The depreciation memo is no longer read.
  - `components/app/schedule-panel.tsx` sends both.
  - `lib/adjust/candidates.ts` covers the stored line first, then matches older schedules as before.
  - `accounting-rules` rule 5a is updated.
  - Tests:
    - Twin 15 jt assets plus a prepayment. Scheduling 1212 with the memo "Susut peralatan" leaves 1210. A stored 1210 line wins
      over a memo naming the prepayment.
    - The writer refuses a line without its entry, an account the entry lacks, a prepayment on the debit side, and an asset under
      an amortisation. The CHECK refuses clearing the entry.
    - The unit test covers the new return shape.
- T17: in `lib/adjust/candidates.ts`, the older-schedule matching weighs only lines that could be a candidate: a prepayment moving
  on the debit side, deferred revenue on the credit side. Test: an entry debiting 1210 and crediting 1170 for 20 jt (a prepayment
  reclassed into an asset), with an older depreciation "Susut rak gudang" of 20 jt. The entry gets no candidate.

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
- T5: the new case fails on the previous ledger ("expected [ 15n, '35' ] to deeply equal [ 10n, '30' ]": last year's expense was in
  the opening) and passes after.
- T5 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 458 passed (458).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (53.7s).
- T6: the new case fails on the previous matching ("expected [ 'Penyusutan Kendaraan 24 Agu 2026' ] …": the scheduled asset stayed)
  and passes after.
- T6 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 458 passed (458).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.7s).
- T7: the new case fails on the previous commit (its memo carried no code and the cut removed the name, so the wrong printer stayed)
  and passes after.
- T7 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 458 passed (458).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.6s).
- T9: the new case fails on the previous matcher ("expected [] to deeply equal [ 'DEPRECIATION:mixed:20000000' ]": the count shortcut
  hid the rack) and passes after.
- T9 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 458 passed (458).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (55.2s).
- T10 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 459 passed (459).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.2s).
- T11 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 459 passed (459).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.8s).
- T12: both new checks fail on the previous code (DB: "expected [ … ] to include 'AMORTIZATION:mixed:12000000'"; unit: "expected
  'entry-1' to be null") and pass after.
- T12 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 459 passed (459).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (50.8s).

- T13: the new case fails on the previous matcher (1 failed | 6 passed in `schedule-candidates.test.ts`) and passes after.
- T13 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 460 passed (460).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.8s).

- T14: both new cases fail on the previous matcher (2 failed | 7 passed in `schedule-candidates.test.ts`) and pass after.
- T14 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 462 passed (462).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.8s).

- T15: the new case fails on the previous matcher (1 failed | 9 passed). An intermediate version that ignored covered lines for
  memo mentions too broke the T9 converted-prepayment case, so memo mentions still count.
- T15 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 463 passed (463).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.9s).

- T16: the stored-line case fails on the previous matcher (1 failed | 11 passed). `prisma migrate diff` from the migrated DB to
  the schema is empty. After e2e, the schedule saved from the candidate in the UI stores 1210 as its line
  (`Penyusutan 1210 Aset Tetap 19 Agu 2026|t|1210`).
- T16 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 465 passed (465).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (53.1s).

- T17: the new case fails on the previous matcher (1 failed | 12 passed).
- T17 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 62 passed (62), Tests 466 passed (466).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.5s).

## Ship Notes
- **Migration:** `20260928010000_schedule_source_line` is additive: a nullable column, a foreign key and a CHECK that existing rows
  satisfy, since the new column is null. `scripts/vercel-build.sh` applies it with `prisma migrate deploy`.
- **Env:** no change.
- **Rollback:** revert the PR. The column can stay, because nothing else reads it.
- **Release:** merges to staging, then rides the promotion PR #37.

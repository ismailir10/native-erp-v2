# Release review fixes 7

## Context
The review of the staging → main promotion (#37, head 5c52246) found two more gaps:
1. **Stopping a schedule dropped already-due installments.** A schedule stopped in September with August still unposted lost
   the August proposal and its `sched:` control. Later periods could then close with understated depreciation or amortisation.
2. **The client-account ledger reinterpreted history after a remap.** The page read every historical line by the source
   account's *current* mapping. Remapping a cash account to an expense dropped the pre-year history; remapping it to a
   liability flipped the running balance. Posted lines stay on their original Buku accounts, so the current mapping is not
   what they were posted as.

## Spec
- [x] A stopped schedule keeps owing its installments due through the month of the stop: they stay proposed (and flagged by
      `sched:`) until posted, and posting them is allowed. Installments after that month are dropped and refused. A stopped
      accrual still reverses what it posted. The stop dialog says so (accounting-rules 5a).
- [x] A client account's ledger takes its normal side, and whether it restarts on 1 January, from the Buku accounts its lines
      were posted to. If those disagree, the file's type decides, then the earliest posted line. With nothing posted, the
      current mapping decides (rule 9a).

**Non-goals:** choosing an explicit stop month (needs a schema change); blocking remaps of accounts with postings.
**Assumptions:**
- The stop month is the UTC month of `stoppedAt`, the same UTC dates the rest of the ledger uses.
- An unwanted overdue installment of a stopped schedule is a REVIEW control the accountant notes at close; it is not a hard block.

## Tasks
- [x] T1 Stopped schedules keep installments due through the stop month — accept: new test fails on the old code
- [x] T2 Client-account ledger reads by posted accounts — accept: new test fails with the old page logic

## Implementation
- T1: `lib/adjust/schedules.ts` adds `owed(stoppedAt, i)`, used by both `dueProposals` and `postInstallment`.
  `stopSchedule` takes an optional `at`, so tests fix the stop month. The stop dialog copy in
  `components/app/schedule-panel.tsx` is updated. Tests in `tests/db/schedules.test.ts`:
  - New: stopped in September with August unposted → August and September stay proposed (REVIEW in October), then post;
    installment 3 is refused.
  - Existing stop tests now pass an explicit stop moment.
  Rule 5a wording updated.
- T2: `lib/reports/account-ledger.ts` adds `sourceLedgerBasis`, and `app/(app)/clients/[id]/ledger/akun/[sourceAccountId]/page.tsx`
  uses it. Test in `tests/db/client-coa.test.ts`: posted cash remapped to 6180, then to 2110, still reads DEBIT with opening
  1000 and balances 1500/1700. An unposted account follows its mapping. Rule 9a wording updated.

## Verification
- T1: the new test fails on the previous code ("expected [] to deeply equal [ 'Penyusutan (1/12)', …(1) ]") and passes after.
- T2: the new test fails with the old page logic ("expected { normalBalance: 'DEBIT', isPL: true } to deeply equal
  { normalBalance: 'DEBIT', isPL: false }") and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 452 passed (452).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (53.8s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

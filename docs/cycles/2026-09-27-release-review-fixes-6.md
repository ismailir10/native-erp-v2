# Release review fixes 6

## Context
The review of the staging → main promotion (#37, head 143664a) found one more gap in adjustment schedules. A schedule could be
backdated into an already locked month. `dueProposals` leaves out installments in locked months (they can no longer post). So the
locked installment was never proposed, and later months could close without it. Example: a two-month schedule starting in
locked August exposed only September, and August's share of the total was never recognised.

## Spec
- [x] `createSchedule` refuses a schedule when any installment, or an accrual's reversal, falls in a month that is already locked.
      The error names the month and says what to do: unlock it or start later (accounting-rules 5a).

**Non-goals:** locking a month after a schedule exists (the `sched:` control already flags the missing installment before the lock).
**Assumptions:** the lock is per client (as `Period` is), the same scope `dueProposals` uses.

## Tasks
- [x] T1 Refuse schedules with an installment in a locked month — accept: new test fails on the old code

## Implementation
- T1: `lib/adjust/schedules.ts` `createSchedule` computes the planned installments (including the reversal) and refuses the
  earliest locked month among them. Test in `tests/db/schedules.test.ts`:
  - A two-month schedule starting in locked August is refused.
  - An October accrual whose 1 November reversal is locked is refused.
  - A schedule starting in open September, between the two locked months, is accepted.
  Rule 5a wording updated.

## Verification
- T1: the new test fails on the previous code ("promise resolved … instead of rejecting"; schedules 1 failed | 9 passed) and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 449 passed (449).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (53.4s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

# Release review fixes 6

## Context
The review of the staging → main promotion (#37, head 143664a) found one more gap in adjustment schedules. A schedule could be
backdated into an already locked month. `dueProposals` leaves out installments in locked months (they can no longer post). So the
locked installment was never proposed, and later months could close without it. Example: a two-month schedule starting in
locked August exposed only September, and August's share of the total was never recognised.

## Spec
- [x] `createSchedule` refuses a schedule when any installment, or an accrual's reversal, falls in a month that is already locked.
      The error names the month and says what to do: unlock it or start later (accounting-rules 5a).

- [x] Review round 2 (#43): schedule creation and closing a month are serialised. `createSchedule` checks the locked months and
      inserts under a per-client advisory lock (`close:<clientId>`). `lockPeriod` notes the month's schedules before running its
      controls, then takes the same lock to write LOCKED and refuses if a schedule for that month appeared meanwhile.

- [x] Review round 3 (#43): the close compares every schedule due by the closing month, not only those with an installment in it,
      since an overdue installment is part of the month's `sched:` control.

**Non-goals:** locking a month after a schedule exists (the `sched:` control already flags the missing installment before the lock).
Serialising every other posting with the close (`postJournal` already refuses a locked period).
**Assumptions:** the lock is per client (as `Period` is), the same scope `dueProposals` uses.

## Tasks
- [x] T1 Refuse schedules with an installment in a locked month — accept: new test fails on the old code
- [x] T2 Serialise schedule creation with closing — accept: both race directions fail without the lock
- [x] T3 The close-race check covers overdue schedules — accept: new case fails with the exact-month filter

## Implementation
- T1: `lib/adjust/schedules.ts` `createSchedule` computes the planned installments (including the reversal) and refuses the
  earliest locked month among them. Test in `tests/db/schedules.test.ts`:
  - A two-month schedule starting in locked August is refused.
  - An October accrual whose 1 November reversal is locked is refused.
  - A schedule starting in open September, between the two locked months, is accepted.
  Rule 5a wording updated.
- T2: `lib/adjust/schedules.ts` adds `closeLock` (a transaction-scoped advisory lock) and `schedulesIn`; `createSchedule`'s check
  and insert run in one transaction under the lock. `lib/controls/index.ts` `lockPeriod` compares the month's schedule ids before its
  controls with those under the lock. The test in `tests/db/schedules.test.ts` covers both directions deterministically, with an
  uncommitted transaction holding the lock:
  - A creation arriving while LOCKED is written waits for it, then is refused.
  - A close whose controls ran while a schedule was being written is refused, and the month stays open.
- T3: `schedulesIn` becomes `schedulesDueBy` (any installment or reversal on or before the month). Test: closing September while a
  one-month July schedule is being written is refused, and September stays open.

## Verification
- T1: the new test fails on the previous code ("promise resolved … instead of rejecting"; schedules 1 failed | 9 passed) and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 449 passed (449).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (53.4s).
- T2: each race direction fails without its lock ("promise resolved … instead of rejecting"; schedules 1 failed | 10 passed) and passes after.
- T2 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 450 passed (450).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (54.3s).
- T3: the new case fails with the exact-month filter ("promise resolved … instead of rejecting") and passes after.
- T3 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 450 passed (450).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.3s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

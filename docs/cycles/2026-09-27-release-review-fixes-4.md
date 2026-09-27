# Release review fixes, round 4 (staging → main)

## Context
The review of the promotion PR (#37) at 4324fb0 found a race in adjustment schedules (#34): a stop committed after the posting
click's check still let the installment post, and a stopped accrual lost the reversal it owed. Ships before the release merges.

## Spec
- [x] Posting an installment locks the schedule row and reads its stop inside the posting transaction; a racing stop either commits
      first (the click is refused) or waits until the installment is recorded (accounting-rules 5a).
- [x] A stopped accrual whose forward installment is posted still proposes and posts its reversal; nothing else posts after a stop.

**Non-goals:** changing what a stop means for depreciation/amortisation.
**Assumptions:** a reversal is always owed once its accrual posted, whatever happens to the schedule afterwards.

## Tasks
- [x] T1 Lock-and-recheck on posting; keep a stopped accrual's reversal — accept: new tests fail on the old code

## Implementation
- T1: `lib/adjust/schedules.ts` — `postInstallment` runs `SELECT … FOR UPDATE` on the schedule in its transaction and refuses a
  stopped one unless the installment is a reversal; `stopSchedule` is a conditional update (same row lock); `dueProposals` also reads
  stopped accruals and proposes only their reversal. Tests (`tests/db/schedules.test.ts`): a stopped accrual still reverses and nets
  2150 to zero, a stopped depreciation proposes/posts nothing; a click arriving while a stop is uncommitted waits and is refused.
  Rule 5a wording.

## Verification
- T1: new tests fail on the previous code (2 failed | 7 passed), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 446 passed (446); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (55.2s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

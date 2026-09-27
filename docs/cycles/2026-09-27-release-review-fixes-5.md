# Release review fixes, round 5 (staging → main)

## Context
The review of the promotion PR (#37) at 0f121c0 found two more defects in staging code: an earlier month's unposted schedule
installment disappeared from later months (so a period could close with depreciation missing), and a failed member insert after a
Supabase invitation left the person impossible to provision. Both ship before the release merges.

## Spec
- [x] An installment is proposed (and flagged by `sched:`) in its month and every later month until posted; one whose month is
      locked is left out, since it can no longer post (accounting-rules 5a).
- [x] Inviting an address that already exists in Auth without a member takes that user over (unban + password link) instead of
      failing; a just-created Auth user whose member insert fails is deleted again.

**Non-goals:** posting into locked months; other invitation flows.
**Assumptions:** a locked month is final: its missing installment is the accountant's decision, not a blocker for later months.

## Tasks
- [x] T1 Overdue installments stay visible; invitation recovers orphan Auth users — accept: new tests fail on the old code

## Implementation
- T1: `lib/adjust/schedules.ts` `dueProposals` — installments due on or before the period, not posted, not in a locked month.
  `lib/auth/operator.ts` `inviteUser` — on a refused invitation, find the address with `listUsers` and take it over; on a member
  insert failure after a fresh invite, `deleteUser`. Tests: `tests/db/schedules.test.ts` (March–August all flagged; posting August
  alone leaves 5; a locked March drops out; posting all clears it; September shows the overdue accrual, not its reversal),
  `tests/db/auth.test.ts` (orphan takeover; compensation). Rule 5a wording.

## Verification
- T1: new/rewritten tests fail on the previous code (schedules 2 failed | 7 passed; auth 1 failed | 5 passed), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 447 passed (447); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (54.3s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

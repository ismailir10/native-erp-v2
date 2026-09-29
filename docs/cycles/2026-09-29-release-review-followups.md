# Release review follow-ups: opening invoices and linked depreciation schedules

## Context
Review of the staging → main release (PR #62, already in production) found two subledger gaps: a Saldo Awal invoice dated before the
opening appeared in aging, CKPN and the `ar:`/`ap:` controls for months before any journal held it (a false subledger/GL difference),
and linking an existing depreciation schedule to a new asset skipped the "not before acquisition" start check that a new schedule gets.

## Spec
- [x] A Saldo Awal invoice enters open items, aging, CKPN and the subledger controls from the entity's opening date; it still ages from its own due date.
- [x] Linking a depreciation schedule refuses one that starts before the acquisition month (or, with opening accumulated depreciation, in or before the opening month).
- [x] accounting-rules 5b and 5c say so.

**Non-goals:** changing how Saldo Awal invoices are created or dated; migrations.
**Assumptions:** an opening invoice's issue date is never after the opening date (already enforced at creation); `subledgerFrom` still takes the later of the two.

## Tasks
- [x] T1 Opening invoices and linked schedules — accept: new tests in tests/db/invoices.test.ts and tests/db/assets.test.ts fail before, pass after.

## Implementation
- T1: lib/receivables/aging.ts (`openingDates`, `subledgerFrom`, `invoicesAt` filter), lib/receivables/ckpn.ts (matrix uses the subledger date),
  lib/assets/register.ts (`assertStart` shared by new and linked schedules), tests, accounting-rules 5b/5c.

## Verification
- Both new tests failed on the previous code (2 failed | 11 passed) and pass now.
- `npm run lint && npm run typecheck && npm test`: lint clean, typecheck clean, `Test Files  92 passed (92)`, `Tests  622 passed (622)`.
- Build, verify:books and e2e run in CI on the PR.

## Ship Notes
- No migrations or env vars. Merge = production deploy. Rollback: revert the commit.

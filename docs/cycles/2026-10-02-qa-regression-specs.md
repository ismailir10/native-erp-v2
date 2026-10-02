# QA regression specs

## Context
The end-to-end QA run ([docs/qa/report.md](../qa/report.md)) and its fixes ([2026-10-02-qa-bug-fixes](2026-10-02-qa-bug-fixes.md)) were verified
with throw-away scripts. The scenarios that found real bugs, and the accounting/access checks that held, should keep running in CI.
Spec approval: the owner asked for the QA scripts to be added as e2e regression specs, so this cycle ran without a separate approval stop.

## Spec
- [x] Playwright specs under `e2e/qa-*.spec.ts` for BUG-001 … 014 (BUG-006 stays a unit test), the PPN/PPh 23 split with exact figures,
      and tenant/role access. UI-only assertions, synthetic data built in memory, a fresh client per test, no order dependence.
- [x] A second firm and an AKUNTAN member for the access specs, created by `scripts/e2e-setup.ts` through the Supabase admin API (real accounts, real form login).
- [x] Prove the specs guard something: run against the pre-fix code and see them fail.

Non-goals: new product behaviour; re-testing what `e2e/` already covers (close/lock walk, receivables aging, tax pack, ledger import).

## Tasks
- [x] `e2e/qa-helpers.ts`, `qa-import-edge-cases`, `qa-amount-input`, `qa-urls-and-layout`, `qa-tax-split`, `qa-access`.
- [x] `scripts/e2e-setup.ts`: AKUNTAN member + second firm and admin (idempotent, credentials in the ignored `.playwright/`).
- [x] Gates: lint, typecheck, `test:e2e` 47/47 (28 existing + 19 new) in both `DEMO_MODE` settings; against `99d9351` 13 of the new specs fail.
- [x] Cost: about +1.2 minutes per e2e pass (CI runs two passes).

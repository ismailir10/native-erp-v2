# Release review fixes 8

## Context
The review of the staging → main promotion (#37, head 1f7a0b5) found one more gap in the close copilot. The ledger anomaly scans
(flux, flip, dormant, duplicates) cite journal rows as `jl:<lineId>` or `je:<entryId>`, even when the row came from a bank line.
`reclassedBankLine()` matched citations only against raw bank transaction ids, so it found none. A correction of such a row was
then stored and posted as a free ADJUSTMENT. That left the bank line's account, review state, tax handling and Memory unchanged,
while the GL was offset separately (rule 3).

## Spec
- [x] A cited journal line or entry resolves to the bank line behind it, so a draft that moves it is a reclassification through
      the reviewer's writer. A draft that moves it any other way gets no draft (accounting-rules 20b).

**Non-goals:** changing what the anomaly scans cite.
**Assumptions:** only the entry's own `bankTransactionId` links a journal row to a bank line (rule 15 lineage).

## Tasks
- [x] T1 Resolve `jl:`/`je:` citations to their bank line — accept: new test fails on the old code

## Implementation
- T1: `lib/controls/explain.ts` adds `citedBankIds`. It adds to the cited ids the `bankTransactionId` of each cited journal line's
  entry and of each cited entry, within the entity. `reclassedBankLine` then looks up bank lines by those ids. The test in
  `tests/db/close-explain.test.ts` covers:
  - Citing the reclass line on 4100, or its entry, resolves to that bank line.
  - A split draft citing the line is AMBIGUOUS.
  Rule 20b wording updated.

## Verification
- T1: the new test fails on the previous code ("expected null to be '<bank tx id>'": the draft would be a free journal) and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 452 passed (452).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (55.4s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

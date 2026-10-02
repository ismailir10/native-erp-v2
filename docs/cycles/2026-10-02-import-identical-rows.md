# Import: identical lines without a running balance (QA blocker)

## Context
End-to-end QA ([docs/qa/report.md](../qa/report.md)) found that a bank statement with two identical same-day lines and no running-balance
column cannot be imported at all: `rowHash` is `sha1(date|amount|description|balance)`, identical rows collide on the unique index
`BankTransaction(bankAccountId, hash)`, the whole transaction rolls back and the user sees "Terjadi kesalahan tak terduga"
([BUG-001](../qa/bugs/BUG-001.md)). Two Rp 15.000 bank fees on one day, or repeated QRIS settlements, are ordinary.

Spec approval: the owner asked for QA blockers to be fixed before the rest are listed, so this change was made without a separate approval stop.

## Spec
- [x] Identical rows within one file get distinct hashes: the nth repeat carries its ordinal; the first keeps the plain hash, so lines imported
      before this change and re-uploads of the same file still dedupe one to one.
- [x] No schema change, no migration, no change for rows that differ in any field.

Non-goals: every other QA finding (see `docs/qa/bugs/`); the generic "Terjadi kesalahan tak terduga" message for other unexpected errors.

## Tasks
- [x] `rowHashes()` in `lib/import/normalize.ts`; `importStatement` uses it.
- [x] Tests: `tests/unit/row-hashes.test.ts`, `tests/db/import-twin-rows.test.ts` (fail before with the production error, pass after).
- [x] Gates: lint, typecheck, `npm test` (868), `verify:books` ALL PASS, `test:e2e` 28/28.

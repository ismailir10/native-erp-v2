# QA bug fixes (BUG-002 … BUG-014)

## Context
The end-to-end QA run ([docs/qa/report.md](../qa/report.md)) found 13 bugs besides the import blocker fixed in
[2026-10-02-import-identical-rows](2026-10-02-import-identical-rows.md). Each is written up in [docs/qa/bugs/](../qa/bugs/README.md) with steps,
root cause and impact. Spec approval: the owner asked for the open bugs to be fixed next, so this cycle ran without a separate approval stop.

## Spec
- [x] **Silent wrong amounts**: `250,000` is refused, not read as Rp 250 (003); amounts beyond 15 digits are refused with a clear message (010);
      rate input knows its currency pair (005); ledger-file text rates keep their decimal (006).
- [x] **Silent wrong dates/balances**: XLSX ISO date cells (002); newest-first statements (004); implausible statement years refused (002).
- [x] **Import robustness**: zero-amount rows skipped with a note (009).
- [x] **Validation/UI**: `parsePeriod` range (007); client-side upload size check (008); NPWP 15/16 digits, normalised (011); mobile tab strip (012);
      per-page titles (013); long text wrap and toast wording (014).

Non-goals: the observations in the QA report §6 (DB-level journal triggers, per-firm AI key, regulatory content review), and any change to
accounting rules or schema. No migration.

## Tasks
- [x] Money/rate parsing — `lib/money.ts`, `lib/fx/currency.ts`, `lib/fx/rates.ts`, `lib/ledger-import/read.ts`, `components/app/rate-form.tsx`
- [x] Import — `lib/import/workbook.ts` (`readableXlsx`), `lib/import/parsers/{index,tabular}.ts`, `lib/import/pipeline.ts`
- [x] Validation/UI — `lib/scope.ts`, `lib/onboarding.ts`, `lib/upload.ts`, import forms, page `metadata`, layout title template
- [x] Tests: `tests/unit/{amount-input,import-qa,qa-validation}.test.ts`, `tests/db/import-twin-rows.test.ts`
- [x] Gates: lint, typecheck, `npm test` (910), `verify:books` ALL PASS, `test:e2e` 28/28; every fix re-run in the browser (`VF-*`).

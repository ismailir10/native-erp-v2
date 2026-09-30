# Side-by-side Neraca (ERP "Balance Sheet Report" exports)

## Context
Client material from the shared Drive (PT Filosofi Kopi Mandiri, Dec 2024) includes a *Balance Sheet Report* exported from the client's
ERP: sheet `BS`, ten metadata rows ("Period 31-12-2024", "Level COA All", …), then one header row that holds **two panels side by side** —
`Account | Level | Description | Value` for Aset on the left and the same four columns for Kewajiban + Ekuitas on the right — with 4-level
account codes written with spaces (`1 1 01 01`), group rows with a zero value (`1 1 00 00 Aset Lancar 0.00`), subtotal rows without a code
("Total Kas") and negative liabilities (`Pph 21 −24.005.554,00`). The same workbook holds four "Profit Loss Report" sheets.

Checked against the current reader (`lib/ledger-import/read.ts`) with the real layout rebuilt as an .xlsx: `detectTables` returns **nothing**,
so the import says "Tabel buku besar atau neraca tidak ditemukan". Reasons: `Value` is not an amount header, `Account` is taken as the
*name* column (it holds codes) with `Description` as a memo, `1 1 01 01` is not a valid account code, only the first panel would be
read, and coded group rows would be posted as accounts (and never open a section, so liabilities would not flip sign). The P&L sheets are
not recognised as reports either ("PnL Profit Loss Report" is not an exact title).

Who feels it: the accountant whose client's ERP prints the Neraca this way (it is a common two-column "Aktiva | Pasiva" layout).

## Spec
- [x] `Value` / `Nilai` headers count as the amount column; a `Level` column is recognised.
- [x] A header row that repeats its column set is read as **panels**; one candidate per sheet, rows of every panel are read in order and refs
      carry the panel's column (`BS!A12`, `BS!F12`) so a row still drills to its source cell. Single-panel files keep `Sheet!12` refs.
- [x] When the "name" column holds codes and a "description" column holds words, they are read as code and name (codes may contain spaces).
- [x] With a `Level` column, a coded row followed by a deeper row is a **group heading**: it opens a section/term (Aset, Kewajiban, Aset Tidak
      Lancar…) and is not an account. Leaves keep their code and name.
- [x] `Total Aktiva` / `Total Pasiva` / `Total Aset` of the file are compared with the imported rows (existing TOTAL_OK / TOTAL_MISMATCH).
- [x] The Neraca date comes from the row labelled Period/Periode/Per before any other date in the header block (the "Generated 14-04-2025" line
      must not win).
- [x] Sheets titled "PnL Profit Loss Report", "Laporan Laba Rugi …", "… Cash Flow Report" are recognised as reports and skipped (title row ≤ 60 chars).
- [x] Real-layout test: FKM Dec 2024 (numbers as text and as numbers) → balanced, Total Aktiva = Total Pasiva = the rows' sum, all
      totals INFO/OK, liabilities flipped, the P&L sheets not offered.
**Non-goals:** posting P&L sheets; more than a header row of panels per sheet; any schema change; any AI.
**Assumptions:** (1) Source codes stay verbatim (`1 1 01 01`), like other files. (2) A group row is a coded row with a deeper next row; a leaf at
the deepest level with value 0 stays an account (as today). (3) I proceed without waiting for approval because the request was to fix what
real client files break; no gate-reopener (no migration, dependency or AI).

## Tasks
- [x] T1 reader: amount/level headers, panel detection, code/name swap, group headings, period date, report titles — accept: `tests/unit/ledger-read.test.ts` new cases
- [x] T2 `rangeRef` and `planNeraca` handle column-qualified refs — accept: unit test + `tests/db/ledger-import.test.ts` FKM case posts balanced
- [x] T3 skills/docs: `accounting-rules` §15a note, README format list — accept: no stale text

## Implementation
- T1: `lib/ledger-import/read.ts` (`headerPanels`, `codesInNameColumn`, `neracaDate`, per-panel `readNeraca`, `Value`/`Level` headers, spaced numeric codes, loose report titles),
  `lib/ledger-import/types.ts` (`TableCandidate.panels`, `ColumnKey` level).
- T2: `lib/ledger-import/check.ts` `rangeRef` groups column-qualified refs (`BS!A15-18,F15-18`); single-panel refs unchanged.
  Tests: `tests/unit/ledger-read.test.ts` (two-panel read, no split on a repeated word, prefixed report titles), `tests/db/ledger-import.test.ts` (stage → map → post, refs).
- T3: `accounting-rules` 15a, README.
- Real-file check (kept out of the repo): the FKM Dec 2024 sheet rebuilt from the Drive text → 148 accounts, the file's Total Aset / Total Aktiva / Total Pasiva match the rows
  (Rp 1 of 7190 rounding: the client's own cents), nothing left without a section.

## Verification
```
$ npm run lint / typecheck  → clean
$ npm test                  → Test Files 108 passed (108); Tests 799 passed (799)
$ npm run build             → completes
$ npm run demo:reset && npm run verify:books → ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.
$ npm run test:e2e          → not run here: the sandbox has no Supabase auth keys (SUPABASE_SECRET_KEY); CI runs it.
```

## Ship Notes
No migration, no env var, no dependency, no AI. Existing files read as before (single-panel refs and codes unchanged); only files that were refused
before, or whose P&L / cash-flow sheet had a prefixed title, behave differently.

# Impor Excel apa adanya — .xls, workbook per bulan, tanggal tanpa tahun, debet/kredit sudut pandang buku

## Context
First feedback round from Syaukani (accountant, 2026-09-28): "baru bisa BCA ya?", "format xls juga". The importer already
reads BCA/BRI CSV, Mandiri XLSX, BCA/Mandiri/BRI/SMBC PDFs and a generic CSV/XLSX, but real files from the pilot clients break it:

| Real file (local only, `~/Downloads`, never committed) | Today |
|---|---|
| Belifi BCA working sheet `ESTATEMENT_…_MAY_26-JUL_26 PT BELIFI.xlsx` | `Format tanggal tidak dikenali: "01/05"` |
| Belifi BCA e-statement PDF (Agustus 2026, 210 rows) | NYAMBUNG ✓ but labelled `GENERIC`: the PDF prints "B C A" letter-spaced |
| any `.xls` (legacy Excel, or HTML/XML saved as .xls — what BNI/BRI CMS/CIMB exports are) | refused: "save as .xlsx" |

The Belifi workbook is the accountant's own working copy of the bank statement, and it breaks four assumptions at once:
one sheet per month (MAY / JUN / JUL, each opening with a `SALDO AWAL` row), `dd/MM` dates with no year anywhere in the
content, **DEBET = money in** (the books' side, not the bank's), a formula `SISA SALDO` column, and an unlabeled column holding the
transaction type. Accountants' working files look like this — reading them as they are is the value.

Outcome: an accountant drops the file they already have (xls, xlsx, per-month sheets) and gets a continuity-checked import,
with every choice the parser made stated in plain Bahasa.

## Spec
- [ ] **Old Excel and disguised Excel are read.** A spreadsheet is recognised from its bytes, not its name: `PK` → xlsx;
      OLE2 (`D0 CF 11 E0`) → legacy BIFF .xls; `<` (HTML table or SpreadsheetML 2003 XML) → read as a table with every cell kept
      as text (so `1.234.567,00` is never parsed as 1.234); plain text → CSV/TSV (tab, `;` or `,`). Legacy/HTML/XML are converted
      to an in-memory .xlsx and flow through the existing ExcelJS code unchanged. Applies to **Impor Mutasi**, **Impor buku
      besar / neraca** and **Dokumen** (evidence upload + Drive).
- [ ] **One workbook, several months.** Each sheet with a transaction table is read on its own. Sheets whose account number is
      the same (or absent) are one account's months: they are joined in date order into **one** statement (opening = first
      sheet's opening, closing = last sheet's closing) and imported all-or-nothing in one transaction. The running-balance check
      runs across the sheet boundary, so a June `SALDO AWAL` that differs from May's closing shows as a gap. Sheets with
      different account numbers stay separate sections, like combined PDFs (the one matching the chosen rekening is imported).
- [ ] **Traceability per sheet.** Each bank row keeps its sheet: `BankTransaction.sourceSheet` (nullable); the ledger drill shows
      "File X, lembar JUN, baris 7".
- [ ] **`SALDO AWAL` / `SALDO AKHIR` rows** (in any text column, with no debit/credit amount) set the opening / closing and are not
      transactions. Unlabeled text columns between the date and the first amount column join the description ("TRSF E-BANKING
      CR · 0205/FTSCY/…"). `SISA SALDO` is a balance header. Numeric cells are read as numbers (never re-parsed from text).
- [ ] **Dates without a year.** `dd/MM` (and `dd-MM`) take the year from the content first (a period line, a sheet name like
      "MEI 2026"). If the content has none, the import stops with a question, not a guess: **"File ini tidak mencantumkan tahun
      (tanggal hanya hari/bulan). Isi tahun bulan pertamanya."** with a year field prefilled from the file name when it holds one
      (`202608`, `2026`, `MAY_26`). Months that go backwards (Des → Jan) roll the year forward. Evidence imports pass the year of
      the source selection's period.
- [ ] **Debet/kredit direction decided by the balance.** With a balance column (≥ 2 balances), the parser reads the rows the bank's
      way (kredit = masuk) and the books' way (debet = masuk); it keeps the bank's way unless only the books' way makes the running
      balance continuous. The choice is a **note on the import**: "Kolom Debet dibaca sebagai uang masuk (sudut pandang
      pembukuan): hanya dengan cara itu saldo berjalan nyambung." Notes are stored on `StatementImport.parseNotes` and shown in
      the import result and the import history. Without a balance column nothing changes.
- [ ] **BCA e-statement PDFs are labelled BCA.** Letter-spaced header text ("B C A", "K C P") is collapsed before the bank is detected.
- [ ] **Form + tools.** Upload accepts `.xls`; the result card shows the notes and the months read; `inspect:statement` takes
      `--year 2026`, prints the notes and each sheet. Docs (`docs/real-data.md`, README supported list) updated.
- [ ] **Proof on real files (local only):** `inspect:statement` on the Belifi workbook shows 3 sheets joined, direction note, and
      `Kesinambungan NYAMBUNG ✓`; the Belifi PDF shows `Format BCA`; a local import of the workbook into a scratch client on
      localhost posts May–Jul with the bank reconciliation PASS for each month.

**Gate-reopeners (flagged):**
- **New dependency:** SheetJS Community Edition `xlsx` 0.20.3 (Apache-2.0), installed from its official tarball
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (the npm registry copy stops at 0.18.5 and has known advisories). Used
  only to read legacy/HTML/XML spreadsheets and write them as .xlsx; ExcelJS stays the reader.
- **Schema migration (additive):** `BankTransaction.sourceSheet String?`, `StatementImport.parseNotes String[] @default([])`.
- No AI calls, no accounting-invariant change (rule 12 all-or-nothing and rule 16 content detection are kept; the year from the
  file name is only a prefill the accountant confirms).

**Non-goals:** parsers for new banks (BNI, CIMB, Permata, BSI…) — next cycle, once real samples arrive; scanned PDFs/OCR;
password-protected .xls; foreign-currency statements; changing how the generic parser finds columns beyond the header words above.

**Assumptions:**
1. A multi-sheet statement workbook belongs to one account unless its sheets print different account numbers.
2. The books' direction is chosen only when the bank's direction breaks continuity and the books' direction has **zero** breaks;
   otherwise the bank's direction stays and continuity reports the gaps (no silent guess).
3. The year prefill comes from the file name but is never used without the accountant's confirmation (the field must be submitted).
4. `sourceSheet` is only set for multi-sheet workbooks and xlsx/xls sources; PDFs/CSVs keep null.
5. The 5 MB upload limit stays.

## Tasks
- [x] T1 Dependency + spreadsheet sniffing: add `xlsx` from the SheetJS tarball; `lib/import/workbook.ts` —
      `sniffSpreadsheet(data)` and `toXlsx(data)` (BIFF / HTML / XML → .xlsx buffer, HTML/XML cells as raw text) — accept:
      unit tests build a BIFF8 file and an HTML "xls" with SheetJS and get the same rows through ExcelJS; lint/typecheck/test green.
- [x] T2 Statement parser: content sniffing in `parsers/index.ts` (no more file-name switch), TSV, `xlsxToSheets` (all sheets,
      numbers as numbers), `parseTabular` gains SALDO AWAL/AKHIR rows, unlabeled description columns, `SISA SALDO`, year-less dates
      with `YearNeededError(guess)`, direction-by-continuity + `notes`, per-sheet sections joined per account; BCA letter-spacing
      in `pdf.ts` — accept: unit tests on synthetic fixtures reproducing the Belifi layout (3 sheets, book direction, no year),
      an HTML .xls, a BIFF .xls, Dec→Jan rollover, a gap at a sheet boundary, and a letter-spaced BCA PDF; existing parser tests green.
      Depends T1.
- [x] T3 Schema + pipeline: migration `import_sheet_notes`; `importStatement` accepts `year`, stores `sourceSheet` and
      `parseNotes`, returns notes + months in `ImportSummary`; ledger drill shows the sheet — accept: DB test imports the synthetic
      Belifi workbook → 3 months posted, recon PASS per month, notes stored; a sheet-boundary gap → continuity REVIEW. Depends T2.
- [x] T4 Actions + UI: `importAction` passes `year`; `fail()` returns `needsYear` + guess; `ImportForm` shows the year field,
      accepts `.xls`, shows notes + months; import history shows notes; ledger import form accepts `.xls` — accept: typecheck + a
      browser walk on localhost (xls upload, year prompt, result card). Depends T3.
- [ ] T5 Ledger import + evidence accept .xls: `readSheets` and `extractEvidence` sniff and convert; Drive accepts `.xls`;
      evidence bank import passes the selection's year — accept: unit tests (ledger read of a BIFF .xls, evidence extract of an
      HTML .xls, Drive no longer rejects .xls). Depends T1.
- [ ] T6 Tools + docs + real-file proof: `inspect:statement --year`, notes/sheets output; `docs/real-data.md`, README; run the
      real Belifi files locally and record results (no client data in the doc) — accept: end-of-cycle gates green; Verification filled.
      Depends T2–T5.

## Implementation
- Plan: tasks T1–T6 sequential, done inline (each builds on the previous parser change; one driver keeps the invariants straight).
- T1: `package.json`, `package-lock.json` (hand-added entry: `npm install` on npm 11 prunes other platforms' optional bindings), `lib/import/workbook.ts`, `tests/xls-fixture.ts`, `tests/unit/workbook.test.ts` — bytes → PDF/XLSX/XLS/MARKUP/TEXT; BIFF/HTML/XML → .xlsx with serial dates kept (no time-zone shift, checked in Asia/Jakarta and America/Los_Angeles) and markup cells as text.- T2: `lib/import/parsers/{index,tabular,pdf}.ts`, `lib/import/{types,normalize,workbook}.ts`, `scripts/inspect-statement.ts` (`--year`, notes, sheets — pulled forward from T6 to test on the real file), `tests/unit/import-workbook.test.ts`, `tests/unit/pdf.test.ts` — format from bytes only; every sheet read (ExcelJS rows are sparse: `Array.from` keeps unlabeled columns); SALDO AWAL/AKHIR rows; year from period line → sheet name → the accountant (`YearNeededError` with a file-name prefill); a year-less month rolls the year only when it falls ≥ 6 months (Des → Jan), so reordered rows never jump a year; direction verdict per sheet (the SALDO AWAL row counts as a balance), sheets that can't tell inherit the account's, disagreement is a note; sheets of one account joined; `.xls` must be a real OLE2 container; BCA letter-spaced header detected with capitals `BCA` standing apart ("SUBCATEGORY" is not BCA).
- T3: `prisma/schema.prisma`, `prisma/migrations/20260928150000_import_sheet_notes` (additive: `BankTransaction.sourceSheet`, `StatementImport.parseNotes`), `lib/import/pipeline.ts` (`year`, notes, months), `lib/reports/account-ledger.ts` + `components/app/ledger-table.tsx` ("File X, lembar JUN, baris 3"), `tests/db/import-workbook.test.ts`.
- T4: `app/actions.ts` (`year` validated 2000–2100, `needsYear` + `yearGuess`), `components/app/import-form.tsx` (year field prefilled once, never overwriting what was typed; `.xls`; period + "Cara file dibaca" on the result), `app/(app)/clients/[id]/import/page.tsx` (notes in the history), `e2e/import-xls.spec.ts`. The ledger-import form's `.xls` moved to T5 with its reader.

## Verification
- T1 gate: lint ✓ typecheck ✓ `Test Files 63 passed (63) · Tests 471 passed (471)`.- T2 gate: lint ✓ typecheck ✓ `Test Files 64 passed (64) · Tests 493 passed (493)`. Real files (local, `inspect:statement`): Belifi workbook → `Lembar MAY, JUN, JUL`, direction note, 135 rows, `NYAMBUNG ✓`, closing Rp 359.000 = the August PDF's opening; both BCA PDFs → `Format BCA`, `NYAMBUNG ✓`; SMBC combined PDF unchanged (3 × `NYAMBUNG ✓`).
- T3: `prisma migrate diff` DB ↔ schema: empty. Gate: lint ✓ typecheck ✓ `Test Files 65 passed (65) · Tests 495 passed (495)` — the DB test posts May–Jul from one .xls with recon PASS for each month and a sheet-boundary gap as continuity REVIEW.
- T4: `npx playwright test e2e/import-xls.spec.ts` → `1 passed` (fresh client → .xls upload → year asked, prefilled 2026 from the name → "Mei 2026 – Juli 2026 (3 bulan)", Nyambung, both notes on the result and in the history). Screenshot checked by eye (kept locally, not committed).

## Ship Notes

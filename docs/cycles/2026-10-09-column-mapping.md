# Any bank's file: point at the columns once, Buku remembers

## Context
After the bank-coverage cycle Buku reads 25 Indonesian banks' documented exports and MT940. Every other file still depends on the
layout-agnostic reader finding a header with a date, a description, amounts and a balance. When it doesn't (a BPR, a regional bank's
odd export, a header in English abbreviations, an internal "mutasi" sheet a client's finance team keeps), the accountant gets an error
and **nothing to do next**: the AI scan reader (`lib/ocr`) only takes scanned PDFs and images ("A PDF with text is never sent"), and
competitors answer the same problem with "fill in our CSV template" (Zahir, Kledo, Accurate's own template).

Who feels it: the accountant on the first file of a new client. One refusal and the trust is gone. The investor question "which banks?"
gets a better answer than a list: *every bank; if Buku doesn't know the layout, you point at the columns once.*

Intended outcome: an unreadable text file (CSV, Excel, text PDF) opens *Atur kolom*: Buku shows the file as a grid, the accountant marks
the date, description, amount and balance columns, and Buku reads every row into the same *Periksa baris* draft the scan reader uses
(proved row by row by the running balance, imported only when it proves). The layout is remembered for the firm, so next month's file
of that layout imports straight away like any supported bank.

## Spec
- [ ] **M1 No dead end** — when a CSV, XLSX/XLS or text PDF can't be read (no table found, or a section the reader refuses), the import
  card keeps the error and offers *Atur kolom* for that file and account. Scans keep *Baca scan dengan AI*; password-protected PDFs
  ask for the password first (as today).
- [ ] **M2 The file as a grid** — CSV/XLSX: cells as written (one sheet at a time, a sheet picker for workbooks). Text PDF: each line's
  text cut into columns at the x-positions the page uses (the reader's own `readLines` cells), page headers and footers left in so the
  accountant sees what Buku sees. The first 30 rows are shown with their row numbers; nothing is sent anywhere.
- [ ] **M3 The mapping** — the accountant marks: the first transaction row (or the header row), *Tanggal*, *Keterangan* (one or more
  columns, joined), the amount as **Debet + Kredit** or as **Jumlah** with its direction from the sign, a marker in the cell
  (`CR/DB/D/K`, reusing `splitMarker`) or a separate direction column, and *Saldo* (optional; without it the draft can't prove itself
  and says so). Date order is guessed from the values (DD/MM vs MM/DD, month names, Excel serials) and can be switched. Rows without a
  date continue the previous row's description; rows whose amount cells are empty are skipped and counted. Buku previews the first
  5 rows read with the mapping before *Baca semua baris*.
- [ ] **M4 Same draft, same proof** — reading with the mapping creates a draft on the existing *Periksa baris* page (`lib/ocr/draft.ts`,
  `proveRows`): opening = the balance before the first row (or the previous import's closing, as for scans), each row proved by the
  running balance, editable, imported only when every row proves, through `importStatement` (dedupe, locked periods, Saldo Awal guard,
  classifier unchanged). The draft says *Dibaca dengan pemetaan kolom* instead of an AI model; no AI call, works with AI off.
- [ ] **M5 Remembered** — on import the mapping is saved for the firm under the file's **layout signature** (file kind + the header
  row's normalised cells, or the column count + first-row shape when there is no header). The next file with the same signature, for
  any client of the firm, is read with it directly inside `parseStatementSections` (after the bank readers and the generic reader fail),
  goes through the normal import (continuity check, *Ada celah* if it breaks), and the result says *Dibaca dengan pemetaan kolom tersimpan*
  with *Lupakan pemetaan ini* (deletes it; the import stays). A signature never matches across firms.
- [ ] **M6 Safe by construction** — amounts are parsed with `parseRupiah` / `splitMarker` into `bigint`; a mapped read that yields no rows,
  a date outside 2000–2100 or an amount beyond 15 digits is refused with the row number (as the pipeline does today). Tenant scoping
  through `getClientForFirm`; the grid and the mapping are built server-side from the uploaded file, never from client-sent cell text.
- [ ] **M7 Production check** — after merge, on a throwaway client *Uji Kolom (hapus)*: an unknown-layout CSV and an unknown-layout text PDF
  (synthetic, `tests/`) go through *Atur kolom* → *Periksa baris* → import with *Saldo nyambung*; next month's file of the same layout
  imports straight away; then the client is deleted. No real client is touched.
- [ ] **Deck (ship step 3)** — review the bank claims ("25 bank … MT940") and add "bank lain: tunjuk kolomnya sekali" only if M5 shipped.

**Non-goals:** AI reading of text files (stays deterministic); editing a saved mapping (forget it and map again); mapping for scans (AI
scan reader); foreign-currency statements (still listed, not imported); batch upload of several files at once (next cycle); changing
the bank readers, `parseRupiah` or the repair rule (rule 12).

**Gate-reopeners flagged:** **schema migration** (additive): new model `StatementLayout` (firm, signature, kind, mapping JSON, who/when,
last used) unique per firm + signature, and `OcrDraft.source` (`OCR` | `MAPPING`, default `OCR`) so the draft page and import note say how the
rows were read. No new dependency, no AI credit, no accounting-invariant change (rows still enter through `importStatement`).

**Assumptions:**
1. The draft page and its proof are reused as they are; the mapped draft differs only in its label and in having no page images.
2. A layout is remembered per **firm**, not per bank account: the same bank export looks the same for every client of the firm.
3. The signature uses the header text, so a bank renaming a column makes the accountant map once more. That's acceptable; a wrong
   automatic match would be worse, and any mismatch still has to pass the running-balance check.
4. The mapping UI fits the import page width (390px: the grid scrolls horizontally inside its card, the page doesn't).

## Tasks
- [x] T1 Grid extraction (`lib/import/grid.ts`): CSV/XLSX sheets and text-PDF lines → `string[][]` with row numbers; layout signature —
  accept: unit tests on synthetic CSV, XLSX and PDF fixtures (a PDF's columns line up with its header cells).
- [x] T2 Mapped reader (`lib/import/mapped.ts`): mapping → `ParsedStatement` (dates with guessed/overridden order, joined descriptions,
  Debet+Kredit / Jumlah+sign/marker/column, Saldo, continuation and empty rows) — accept: unit tests per amount style and date order;
  a fixture's rows chain NYAMBUNG.
- [x] T3 Schema + draft (migration `StatementLayout`, `OcrDraft.source`; `createMappedDraft` in `lib/ocr/draft.ts` reusing `proveRows` and
  `importOcrDraft`; layout saved on import) — accept: db test: unknown CSV → draft proves → import → layout stored; AI off works.
- [x] T4 Remembered layouts in `parseStatementSections` + *Lupakan pemetaan ini* — accept: db test: same-signature file imports directly
  with the note; another firm's layout never applies; forgetting deletes only the layout.
- [ ] T5 UI: *Atur kolom* on a failed import, grid + column pickers + 5-row preview → *Baca semua baris* → *Periksa baris* (label), result
  note + forget action — accept: e2e `statement-column-mapping.spec.ts` (CSV and PDF; second file auto); screenshot at desktop and 390px.
- [ ] T6 End-of-cycle gates, Ship Notes, production check (M7), deck review.

## Implementation
- Plan: T1–T6 sequential, inline (each builds on the last: grid → reader → draft → remembered → UI; no independent slice worth delegating).
- Narrowed while building (stated here, not silently): **Saldo is required** in a mapping — `proveRows` treats a row without a balance as
  unproved, so a mapping without one could never import; and a mapping is **remembered only when the file has a header row** (the
  signature is the header's words; a data-row shape is too weak to apply automatically). One mapping reads **one account**: a combined
  file of several accounts (SMBC consolidated) stays with its own reader.
- T1: `lib/import/grid.ts` (`readGrid`: CSV cells as written, workbook sheets with Excel dates as ISO text, text PDF lines cut into the
  columns of the widest line at or just above the common row width — the header, so Debet and Kredit stay apart; `layoutSignature`:
  kind + normalised header words, null for a data row; `sameRow` for repeated page headers). Fixtures `tests/unknown-layout.ts`
  (CSV / PDF / XLSX in column words no reader knows; August or September). Test: `tests/unit/statement-grid.test.ts`.
- T2: `lib/import/mapped.ts` (`checkMapping`: every named column exists, one job per column, Saldo required; `readMapped`: Debet + Kredit or
  Jumlah with a D/K column, a marker in the cell or its sign; a "Saldo awal" row or the first balance as opening; dateless description rows
  continue the transaction above, totals and page furniture skipped and counted; repeated headers skipped; newest-first reversed; year-less
  dates take the given year and run on into January; words in an amount column refused with the row; `guessOrder`; `signatureOf`;
  `suggestMapping`: date column = most dates, numbers = digit columns that aren't written dates, balance = the right-most, a D/K column,
  every other text column joined as the description). Test: `tests/unit/statement-mapped.test.ts`. Checked locally (not committed)
  on the real BCA PDF in `data/private/`: the suggested mapping plus the year reads 31 rows and the running balance chains.
- T3: migration `20261009150000_statement_layouts` (`StatementLayout` unique per firm + signature; `OcrDraft.source` default `OCR`);
  `lib/ocr/draft.ts` `createMappedDraft` (bank account checked for the firm and client, grid and rows from the uploaded bytes, opening
  from the file, no AI and no workspace switch) and `importOcrDraft` (file name "(pemetaan kolom)", its own note, the layout upserted
  once the draft is imported: the mapping less sheet, first row and year); `draftCsv` keeps an unprinted balance empty; `proveRows`
  `chained` for mapped drafts only (BCA prints a balance per day: a stretch is proved by the next printed balance, or breaks with it).
  `accounting-rules` 16c. Test: `tests/db/mapped-draft.test.ts`.
- T4: `parseStatementSections` takes the firm's layouts: when every reader refuses (password, missing year and scans excepted), the file is
  read with the first layout whose header it carries (any sheet, first 80 rows; `readWithLayout` in `lib/import/mapped.ts`), repaired like
  any statement and noted "Dibaca dengan pemetaan kolom tersimpan (dari …)"; a matching header with unreadable rows is refused naming the
  layout; otherwise `UnreadableFileError` (the reader's own message) so the import page can offer *Atur kolom*. `importStatement` loads the
  firm's layouts, returns `summary.layout` and stamps `lastUsedAt`; a section's repair refusal is an `UnreadableFileError` too.
  `lib/import/layouts.ts` `forgetLayout` (firm-scoped). Test: `tests/db/remembered-layout.test.ts`.
## Verification
- T1: lint clean · typecheck clean · `npm test` 200 files, 1329 passed.
- T2: lint clean · typecheck clean · `npm test` 201 files, 1341 passed.
- T3: lint clean · typecheck clean · `npm test` 202 files, 1346 passed.
- T4: lint clean · typecheck clean · `npm test` 203 files, 1352 passed.
## Ship Notes

# Bank parser hardening — CSV/XLSX/PDF from banks we haven't seen

## Context
An audit fed synthetic statements in the layouts of BCA, Mandiri (Livin' / Kopra), BNI (Direct / Mobile), BRI (internet banking / BRImo),
CIMB (OCTO), Permata and SMBC to the parsers (fixtures private, generators rebuilt here under `tests/`). 12 of 26 files failed or
silently produced wrong numbers, all in the *format detection and reading* layer, not the ledger:

- BRI / BNI / BSI internet-banking CSVs are routed to the BCA parser (it sniffs "Mutasi Rekening" + "Tanggal Transaksi") and fail with a
  BCA-specific error.
- Dates written with month names (`01-Aug-26`, `01 Agu 2026`, `05-Okt-2026`), in CSV/XLSX cells and in PDF rows, are rejected; XLSX date cells
  formatted General arrive as serial numbers (`46235`).
- A PDF amount printed `+1.000.000` (Livin' Nominal) becomes **0** — a silent wrong number that the continuity check only catches afterwards.
- Header names in the wild are missed: `Post Date`, `Tgl. Transaksi`, `Transaction Desc`, `Uraian Transaksi`, `Debit (IDR)`, `Jumlah (IDR)`.
- The CSV delimiter is chosen from the first line only, so a title row before the header breaks `;` files; UTF-16 text exports ("Unicode
  text" from Excel) are not decoded.
- A separate `D/K` · `DB/CR` column with an unsigned amount (BNI Mobile) is read as all-positive.
- Sen (`1.500.000,50`) are rounded silently; a BRI `TGL_TRAN` CSV with an empty balance column throws; CSV/XLSX never get a bank
  code other than GENERIC/MANDIRI; a multi-account PDF looks for the bank name in the whole text.
- The *Tambah klien* form: saving with an empty bank-account row looks like nothing happened.

Who feels it: the accountant onboarding a client whose bank isn't BCA/Mandiri/SMBC — the first file they try decides whether they trust
the product. Intended outcome: every audit fixture parses with a continuous running balance, and anything unreadable fails loudly.

## Spec
- [x] **P1 Routing:** `isBcaCsv` needs the KlikBCA header shape (a header row whose first cell is `Tanggal Transaksi` and that has a
      `Jumlah`/`Cabang` column with the `'DD/MM` rows) — BRI/BNI internet-banking CSVs with "Mutasi Rekening" titles go to the generic reader. If a
      BCA/BRI-specific parser throws a `ParseError`, the generic reader gets a try before the error is shown (the original error when both fail).
- [x] **P2 Dates:** `dd-Mmm-yy`, `dd-Mmm-yyyy`, `dd Mmm yyyy`, `dd/Mmm/yyyy`, Indonesian (Agu, Agt, Okt, Des, Mei, Nop…) and English month
      names, 2-digit year → 20yy, in tabular cells and PDF rows (also with a time suffix). Excel serial numbers (a bare 5-digit number in
      the date column) read as dates. One shared reader in `parsers/common.ts`.
- [x] **P3 PDF amounts:** a leading `+` and an `Rp` prefix are read; an amount-column token that is not a number is never turned into 0 — the
      row's statement fails with a message naming the page/text (no silent 0).
- [x] **P4 Headers:** `Post(ing) Date`, `Tgl. Transaksi`, `Transaction Desc(ription)`, `Remark(s)`, `Uraian (Transaksi)`, `Narasi`, `Jumlah (IDR)`,
      `Debit (IDR)`, `Credit (IDR)` … in CSV/XLSX (and the PDF header where it applies).
- [x] **P5 Delimiter & encoding:** the delimiter (`,` `;` tab) is chosen by consistency over the first ~10 non-empty lines; a UTF-16 (BOM)
      text file is decoded.
- [x] **P6 D/K column:** a column whose values are only D/K/DB/CR/DR/Debet/Kredit (with an unsigned amount column) sets the sign; the
      running balance stays continuous.
- [x] **P7 Sen & empty balance:** a non-zero fraction in an amount adds a `ParsedStatement.notes` entry ("… dibulatkan ke Rupiah …") — still
      whole Rupiah (accounting-rules §6a), never silent. BRI `TGL_TRAN` with an empty balance column no longer throws (opening from
      the first rows' balance if any, else the same clear error as other formats only when truly undeterminable).
- [x] **P8 Bank tag:** CSV/XLSX are tagged from content (Mandiri / BRI / BCA / SMBC keyword in the preamble rows, else GENERIC); a multi-account PDF
      detects the bank from the statement preamble, not the whole text. No enum change.
- [x] **F1 Tambah klien:** a fully empty bank-account row (no number, no name, not PRK) is ignored on save; any other problem is shown on the
      field in Bahasa and also as a toast so it's visible off-screen.
- [x] Each item has a regression test that failed before the change; no existing test weakened; `verify:books` still ALL PASS.

**Non-goals:** BCA `PEND` row semantics (`bca.ts:43-50` — needs a real file); new `BankCode` values / schema migration; OCR of scanned PDFs;
new banks' *PDF* layouts beyond the header/date/amount variants above; changing `parseRupiah`'s rounding rule (rule 6a) — only surfacing it.

**Assumptions:**
1. `parseRupiah` (lib/money.ts) stays as is (used across the app); the parsers warn about a fraction by inspecting the source text (`hasSen`
   in `parsers/common.ts`) — no new channel needed, `ParsedStatement.notes` is already shown as an import note.
2. Two-digit years are 20yy (statements are recent). Ambiguous `dd/mm` vs `mm/dd` stays dd/mm (Indonesian banks).
3. UTF-16 detection = BOM (FF FE / FE FF) only; BOM-less UTF-16 is not guessed.
4. Fixtures are synthetic (fake company, account numbers `0000…`), built in-test with exceljs / `tests/pdf-fixture.ts` — nothing under `data/private/`.
5. No new dependency, no schema migration, no AI use.

## Tasks
- [x] T1 Test fixture builders + routing fix (P1) — accept: `bri-ib.csv` shape parses via the generic reader with continuous balance; BCA CSV tests unchanged.
- [x] T2 Delimiter by consistency + UTF-16 decoding (P5) — accept: title-row `;` CSV and UTF-16 tab file parse.
- [x] T3 Header patterns (P4) — accept: `Post Date` / `Transaction Desc` / `Debit (IDR)` layouts parse (needs T2 for the delimiter cases only where noted).
- [x] T4 Month-name & serial dates in tabular files (P2, part 1) — accept: bni-direct.xlsx, mandiri-livin signed xlsx, cimb `;` csv, serial xlsx.
- [x] T5 PDF dates, `+`/`Rp` amounts, no silent zero (P2 part 2, P3) — accept: cimb-dd-Mmm-yyyy.pdf and mandiri-livin-nominal-plus.pdf.
- [x] T6 D/K flag column (P6) — accept: bni-mobile-dk-flag.xlsx continuous.
- [x] T7 Sen note + BRI empty balance (P7) — accept: note present and rows still whole Rupiah; bri-nobal.csv parses.
- [x] T8 Bank tag from content + PDF preamble bank detection (P8) — accept: fixtures tagged; a multi-account PDF whose body mentions another bank keeps its own.
- [x] T9 Tambah klien empty bank row (F1) — accept: unit test on validation; visible message in the form.

## Implementation
- Plan: tasks T1–T9 sequential, done inline (each touches the same parser files; no independent slice worth delegating).
- T1: `parsers/bca.ts` (sniff needs the KlikBCA `Tanggal Transaksi, Keterangan, Cabang` header), `parsers/index.ts` (a BCA/BRI-specific reader that throws a ParseError falls back to the generic reader; the specific error is kept if both fail, a `YearNeededError` from the generic reader wins), `parsers/tabular.ts` (account number read with hyphen groups, dates excluded), `tests/bank-fixture.ts` (synthetic layouts), `tests/unit/bank-parsers.test.ts`.
- T2: `parsers/common.ts` (`detectDelimiter`: consistency over the first 12 non-empty lines, quotes ignored; `decodeText`: UTF-16 LE/BE with BOM), `parsers/index.ts` uses both; tests in `tests/unit/bank-parsers.test.ts`.
- T3: `parsers/tabular.ts` (wider date/desc/debit/credit patterns; a header names date and description in different cells; a bracketed currency after a label — "Debit (IDR)" — is ignored), `parsers/pdf.ts` (same label additions and unit stripping for the PDF header row).
- T4: `parsers/common.ts` (one shared `dateParts`: numeric with 2/4-digit year and an optional time, ISO, month names Indonesian/English (`dd-Mmm-yy`, `dd Mmm yyyy`, `Mmm dd, yyyy`), year-less; `excelSerialDate` behind an opt-in for tabular date cells; `MONTHS` moved here; `parseDateDMY` uses it — BRI now also reads `dd-Mmm-yy`), `parsers/tabular.ts` uses it. Tests: `tests/unit/bank-dates.test.ts`, four end-to-end layouts in `bank-parsers.test.ts`.
- T5: `parsers/pdf.ts` (`parseDate` on the shared `dateParts`: month names, hyphens, 2-digit years; `NUMBER` takes a leading `+`/`-` and `Rp`/`IDR`; a digit-and-punctuation figure under an amount column that isn't a number marks its row `unreadable`, and a dated row that ends with no amount but such a figure fails the parse with the page and text instead of becoming 0). Tests: 6 PDF cases in `bank-parsers.test.ts`.
- T6: `parsers/tabular.ts` (`flagColumn`: the first column beside a single amount column whose non-empty cells are all D/K-type values — D/DB/DR/Debet/Debit out, K/CR/C/Kredit/Credit in — sets the sign of |amount|; excluded from the description; a dated movement row with no flag fails with its row number; a note says the column was used). Tests: 6 cases in `bank-parsers.test.ts`.
- T7: `parsers/common.ts` (`SenWatch`: collects amounts/balances with a non-zero fraction via `parseCents`, one Bahasa note with up to three examples; `openingFromBalances`: opening from the first printed balance less the movement up to it), used by `tabular.ts`, `bca.ts`, `bri.ts`, `pdf.ts` → `ParsedStatement.notes` (the existing channel shown with the import). `parseRupiah` is untouched: amounts stay whole Rupiah, half-up (rule 6a). BRI with a balance column that is empty on the first rows derives the opening from a later balance; empty on every row → opening 0 plus a note that it is unknown (BCA's no-trailer fallback is the same 0).
- T8: `parsers/pdf.ts` (`detectFormat` exported and stricter — bank names such as "Bank Mandiri", Livin', Kopra, "Bank Rakyat", BRImo, BCA, SMBC/Jenius; Mandiri no longer from a bare "Mandiri"/"Bri" that a company name contains; the multi-account path reads it from the lines above the first section, not the whole text), `parsers/tabular.ts` (a GENERIC statement takes its bank from the lines above and including the header; `isMandiriRows` removed — it scanned data rows). No enum change; a file that names no bank stays GENERIC (CIMB, BNI, Permata have no code).
- T9: `lib/blank-bank.ts` (`isBlankBankRow`: no number, no name, not PRK), `lib/onboarding.ts` (`validateNewClient` skips blank rows but keeps their index in error keys), `components/app/client-form.tsx` (redirect uses the same helper; a server field error is also raised as a toast so it is seen off-screen), `tests/db/onboarding.test.ts`, `e2e/new-client-bank-row.spec.ts`. Finding: before the change the field message "Isi nomor rekening." *was* rendered under the row (the e2e step for it passed before), but the untouched default row blocked saving; the e2e step that saves with the empty row failed before the change and passes after.
- Review pass (after T9): `pdf.ts` — BCA/BRI detection kept case-insensitive (a lowercase `bca.co.id` in a heading must still tag BCA; only Mandiri needs the stricter names), and a date-like cell under an amount column is not an "unreadable amount". Replay of every audit fixture (`run.mts` / `extra.mts`, private scratch): all now parse with `cont=true`; the only remaining failures are the documented non-goals (`bca-klikbca-nobalance-pend.csv` PEND row, scanned PDF) and an unquoted comma inside a BCA description (`bca-comma-in-desc.csv`, not in scope).
- Risk noted: BRI with no balance on any row reads with opening 0 (flagged in the import notes) — Saldo Awal prefills 0 from it; same as BCA's existing no-trailer fallback.

## Verification
- T1 gate: lint clean, typecheck clean, `npm test` 95 files / 638 tests passed. New tests failed before the change (BRI IB fixture: "Baris 'Periode' BCA tidak ditemukan").
- T2 gate: lint, typecheck clean; `npm test` 95 files / 642 tests passed. The 4 new tests failed before ("Kolom debet/kredit atau jumlah tidak ditemukan", UTF-16 not decoded).
- T3 gate: lint, typecheck clean; `npm test` 95 files / 649 tests passed. The 6 new header tests failed before (NoTableError / missing amount column).
- T4 gate: lint, typecheck clean; `npm test` 96 files / 680 tests passed. New tests failed before (`dateParts is not a function`; "Format tanggal tidak dikenali … 01/08/26 10:15:30 / 01-Aug-2026 / 01 Agu 2026 / 46235").
- T5 gate: lint, typecheck clean; `npm test` 96 files / 686 tests passed. New PDF tests failed before ("Tidak ada baris transaksi yang terbaca"; Livin' amounts `0n,-2450000n,…`; the unreadable amount resolved instead of rejecting).
- T6 gate: lint, typecheck clean; `npm test` 96 files / 693 tests passed. New tests failed before (all amounts positive; missing flag not refused).
- T7 gate: lint, typecheck clean; `npm test` 96 files / 698 tests passed. New tests failed before (no note; BRI "Saldo awal tidak dapat ditentukan (kolom saldo kosong)").
- T8 gate: lint, typecheck clean; `npm test` 96 files / 709 tests passed. New tests failed before (CSV always GENERIC, a data row mentioning Mandiri tagged MANDIRI, a Mandiri PDF whose transaction names Jenius tagged SMBC).
- T9 gate: lint, typecheck clean; `npm test` 96 files / 710 tests passed. The new unit test failed before ("Periksa 2 isian yang ditandai."). `e2e/new-client-bank-row.spec.ts` against `next dev` on :3200: failed before (no navigation after saving with an empty row), `1 passed` after.

### End of cycle
- `npm run lint` / `npm run typecheck`: clean. `npm test`: `Test Files  96 passed (96)`, `Tests  710 passed (710)`.
- `npm run build`: completed (route table printed, exit 0).
- `npm run test:e2e` (against that build): `25 passed (1.1m)`, including the new `e2e/new-client-bank-row.spec.ts`.
- `npm run verify:books`: `ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.` (run before e2e and again after `npm run demo:reset` on the local DB; a run straight after e2e fails on CV Sinar Retail 2026-08 because the e2e specs post journals into the demo firm — see the e2e work-period gotcha — not because of this cycle).

## Ship Notes
- No migration, no env var, no new dependency, no AI call. Parsers, one tiny shared helper (`lib/blank-bank.ts`), one form change.
- Manual: none. Import notes now show sen and D/K messages; BRI files without any balance import with opening 0 and a note.
- Rollback: revert the merge commit; nothing persisted depends on the new behaviour (`StatementImport.format` may now hold MANDIRI/BRI/BCA for CSV/XLSX files that name the bank — the same enum values PDFs already use).
- Not done: BCA `PEND` row semantics (needs a real file); an unquoted comma inside a BCA CSV description; Mandiri Kopra CSV (no bank name in the file, stays GENERIC); UTF-16 without a BOM.

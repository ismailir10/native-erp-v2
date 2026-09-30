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
- [ ] **P1 Routing:** `isBcaCsv` needs the KlikBCA header shape (a header row whose first cell is `Tanggal Transaksi` and that has a
      `Jumlah`/`Cabang` column with the `'DD/MM` rows) — BRI/BNI internet-banking CSVs with "Mutasi Rekening" titles go to the generic reader. If a
      BCA/BRI-specific parser throws a `ParseError`, the generic reader gets a try before the error is shown (the original error when both fail).
- [ ] **P2 Dates:** `dd-Mmm-yy`, `dd-Mmm-yyyy`, `dd Mmm yyyy`, `dd/Mmm/yyyy`, Indonesian (Agu, Agt, Okt, Des, Mei, Nop…) and English month
      names, 2-digit year → 20yy, in tabular cells and PDF rows (also with a time suffix). Excel serial numbers (a bare 5-digit number in
      the date column) read as dates. One shared reader in `parsers/common.ts`.
- [ ] **P3 PDF amounts:** a leading `+` and an `Rp` prefix are read; an amount-column token that is not a number is never turned into 0 — the
      row's statement fails with a message naming the page/text (no silent 0).
- [ ] **P4 Headers:** `Post(ing) Date`, `Tgl. Transaksi`, `Transaction Desc(ription)`, `Remark(s)`, `Uraian (Transaksi)`, `Narasi`, `Jumlah (IDR)`,
      `Debit (IDR)`, `Credit (IDR)` … in CSV/XLSX (and the PDF header where it applies).
- [ ] **P5 Delimiter & encoding:** the delimiter (`,` `;` tab) is chosen by consistency over the first ~10 non-empty lines; a UTF-16 (BOM)
      text file is decoded.
- [ ] **P6 D/K column:** a column whose values are only D/K/DB/CR/DR/Debet/Kredit (with an unsigned amount column) sets the sign; the
      running balance stays continuous.
- [ ] **P7 Sen & empty balance:** a non-zero fraction in an amount adds a `ParsedStatement.notes` entry ("… dibulatkan ke Rupiah …") — still
      whole Rupiah (accounting-rules §6a), never silent. BRI `TGL_TRAN` with an empty balance column no longer throws (opening from
      the first rows' balance if any, else the same clear error as other formats only when truly undeterminable).
- [ ] **P8 Bank tag:** CSV/XLSX are tagged from content (Mandiri / BRI / BCA / SMBC keyword in the preamble rows, else GENERIC); a multi-account PDF
      detects the bank from the statement preamble, not the whole text. No enum change.
- [ ] **F1 Tambah klien:** a fully empty bank-account row (no number, no name, not PRK) is ignored on save; any other problem is shown on the
      field in Bahasa and also as a toast so it's visible off-screen.
- [ ] Each item has a regression test that failed before the change; no existing test weakened; `verify:books` still ALL PASS.

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
- [ ] T2 Delimiter by consistency + UTF-16 decoding (P5) — accept: title-row `;` CSV and UTF-16 tab file parse.
- [ ] T3 Header patterns (P4) — accept: `Post Date` / `Transaction Desc` / `Debit (IDR)` layouts parse (needs T2 for the delimiter cases only where noted).
- [ ] T4 Month-name & serial dates in tabular files (P2, part 1) — accept: bni-direct.xlsx, mandiri-livin signed xlsx, cimb `;` csv, serial xlsx.
- [ ] T5 PDF dates, `+`/`Rp` amounts, no silent zero (P2 part 2, P3) — accept: cimb-dd-Mmm-yyyy.pdf and mandiri-livin-nominal-plus.pdf.
- [ ] T6 D/K flag column (P6) — accept: bni-mobile-dk-flag.xlsx continuous.
- [ ] T7 Sen note + BRI empty balance (P7) — accept: note present and rows still whole Rupiah; bri-nobal.csv parses.
- [ ] T8 Bank tag from content + PDF preamble bank detection (P8) — accept: fixtures tagged; a multi-account PDF whose body mentions another bank keeps its own.
- [ ] T9 Tambah klien empty bank row (F1) — accept: unit test on validation; visible message in the form.

## Implementation
- Plan: tasks T1–T9 sequential, done inline (each touches the same parser files; no independent slice worth delegating).
- T1: `parsers/bca.ts` (sniff needs the KlikBCA `Tanggal Transaksi, Keterangan, Cabang` header), `parsers/index.ts` (a BCA/BRI-specific reader that throws a ParseError falls back to the generic reader; the specific error is kept if both fail, a `YearNeededError` from the generic reader wins), `parsers/tabular.ts` (account number read with hyphen groups, dates excluded), `tests/bank-fixture.ts` (synthetic layouts), `tests/unit/bank-parsers.test.ts`.

## Verification
- T1 gate: lint clean, typecheck clean, `npm test` 95 files / 638 tests passed. New tests failed before the change (BRI IB fixture: "Baris 'Periode' BCA tidak ditemukan").
## Ship Notes

# Testing with real client statements

Real bank statements are client data (NDA, UU PDP). This page says where they may go and how to take one from
file to a closed month.

## Rules
1. There is **one workspace** ([ADR 0008](adrs/0008-one-workspace.md)). Real client work lives in production (https://native-erp-v2.vercel.app),
   behind invitation-only login, on Neon branch `real-data` with `DEMO_MODE=false`. Staging is synthetic pre-production: never upload real files there.
2. Real data lives in exactly two places:
   - **Local**: Postgres on your machine. Files go in `data/private/` (gitignored).
   - **Production**: the workspace above. No demo firm and no reset. Never point `demo:reset` at its database.
3. Never commit a statement, a screenshot of one, or `inspect:statement` output. Tests use synthetic fixtures (`tests/pdf-fixture.ts`).
4. With an AI key set, *unrecognised* lines go to the AI gateway (OpenCode Zen): the merchant key, the first 80 characters
   of the description, and the client's name and business type. Lines matched by transfers, rules or memory are never sent.
   Leave the key empty for rules-only.
5. The authenticated [evidence workspace](evidence-workspace.md) can send bounded source passages to AI for explicitly requested context proposals and question planning. This is broader than merchant/account-name classification above; source files and citations remain private.
6. PDF passwords are used once to open the file. They're never stored or logged.

## 1. Check the file before importing (no database)
```bash
npm run inspect:statement -- data/private/bca-agustus.pdf
PDF_PASSWORD=01011980 npm run inspect:statement -- data/private/mandiri.pdf   # password-protected PDF
npm run inspect:statement -- data/private/bri.pdf --lines                       # raw PDF text with x positions
```
Look for `Kesinambungan NYAMBUNG ✓`. That means opening + every row = every printed balance = closing, so no row was
lost or misread. `ADA CELAH ✗` names the broken rows. Exit code 2 means a gap.

Supported: text PDF e-statements (BCA / Mandiri / BRI-style layouts), KlikBCA CSV, Mandiri XLSX, BRI CSV, and any CSV/XLSX
with tanggal / keterangan / debet-kredit (or mutasi) / saldo columns. Combined PDFs with several accounts (e.g. SMBC
"Laporan Konsolidasi Rekening") print one block per account; each is checked on its own and the import takes the section
whose number matches the selected bank account. Foreign-currency sections are listed but not imported.
Not supported: scanned PDFs (no text layer) and `.xls` (save as `.xlsx`). Both get a clear message.

**If a format fails**, send only the column header line and one anonymised row from `--lines`, with amounts and names
changed. That's enough to add the layout.

## 2. Add the client
Navigasi → **Daftar klien** → **Tambah klien**. Enter the client (group) name and business type, then one entity per company or person
with its own books (PT/CV first, then the owner) and its **Mata uang pembukuan** (IDR unless it keeps books in e.g. SGD).
Add each bank account with its number as printed on the statement; tick **PRK** for an overdraft loan account (its balance
is a debt to the bank). An entity whose books come from a ledger file needs no bank account: remove the row.
Imports refuse a file whose account number doesn't match.

## 3. Saldo awal
You land on **Saldo Awal** after saving. The date is the day before the first statement you'll import. If you import
first, bank lines are prefilled from that statement's opening balance. Add receivables, fixed assets, loans and capital
if you have them. The difference goes to 3200 Saldo Laba. One opening entry per entity; later corrections go through
Jurnal Penyesuaian.

## 4. Import → review → close
Same flow as the demo: **Impor Mutasi** (PDF asks for its password) → **Review** → **Laporan Keuangan** → **Tutup Buku**.
The controls show whether the books match the bank:
- *Rekonsiliasi* compares the statement's closing balance with the GL. It fails until Saldo Awal is posted.
- *Kelengkapan mutasi* shows the continuity result.
- *Kliring 1199* stays open until both sides of a transfer between own accounts are imported.

## 5. Ledger or Neraca from the client's old system (Jurnal, Accurate, Excel)
**Impor → Buku besar / neraca**. XLSX or CSV. A ledger needs tanggal, kode/nama akun, debit, kredit (optional: entitas,
no. bukti, mata uang, kurs, notes with `Rate: 1.31`). A Neraca needs kode/nama akun and saldo (Jurnal's export works as is).
1. **Periksa file.** Nothing is posted yet. Choose the sheet if the file holds several tables.
2. **Pemeriksaan file.** BLOCK items stop the import: fix the file, or for an unbalanced journal *Terima & catat selisih ke 1999*
   (the difference stays visible in 1999 and fails Tutup Buku until a Jurnal Penyesuaian moves it). REVIEW items (codes reused
   with another name, foreign lines without a rate, balances against the account's nature) show up as a close control.
3. **Pemetaan akun.** Each account in the file keeps its own code and maps to one Buku account. Rule suggestions are filled in
   after upload; *Minta saran AI* sends only account codes, names and types (never amounts). Nothing counts until you accept it.
4. **Catat.** All journals post together, or none. Check **Neraca Saldo → Akun sumber** against the client's own TB.

From Google Drive: **Dokumen → Tambahkan dokumen → Baca folder** reads the same sheets; confirm each postable sheet as
Sumber pencatatan (multi-entity ledgers via *Sesuai kolom Entitas di file*, Neraca with its date) and **Siapkan impor** opens the
same draft. Keep the folder small (one workbook) — see [evidence workspace](evidence-workspace.md).

Currency: *Jumlah sudah dalam mata uang entitas* posts the amounts as written (default, faithful to the file).
*Konversi dengan kurs* converts foreign lines with the rate in the file, else the **Kurs** page on that date. The same choice
(**Baris valas**) appears in Dokumen for a confirmed ledger sheet with foreign rows; to switch after preparing, *Batalkan draf*
and prepare again. A journal that balances in each of its source currencies posts its conversion rounding (≤ 1 minor unit per
converted line) to 7190; any larger gap is a difference in the file and must be accepted into 1999 or fixed.

## 6. Kurs and Gabungan Grup in Rupiah
Entities in another currency are translated for the Gabungan: assets & liabilities at the month's closing rate, income &
expense at the year's average rate, equity at the historical rate; the difference is *Selisih penjabaran mata uang asing*.
The **Kurs** page lists every rate that's still missing; a report without its rates says *belum dijabarkan* instead of
showing a number. Rates are typed in (or taken from the imported file); Buku never fetches them. A rate written in a file only
fills a date the Kurs table doesn't have yet: it never replaces an existing rate (the table is shared by every client of the
firm). When the file's rate differs, the draft lists it under *Perlu dicek* (`Kurs … di file berbeda dari tabel Kurs …`).
Foreign balances (lines imported with a rate) are revalued at month end on **Tutup Buku → Catat revaluasi**.

## 7. Check a real file end to end (local only)
```bash
npm run verify:real -- chickin      # or goers | smbc | all; add --into-app to load it into the firm the app shows
```
Imports the files in `data/private/` into a fresh client and compares Buku with the files themselves; the report goes to
`data/private/reports/` (never commit it). Rates for the Gabungan come from `data/private/rates.csv`
(`currency,quote,date,kind,rate,note`).

## Environments
| Where | How to open | Database |
|---|---|---|
| Local | `npm run dev` with `.env` → `postgresql://buku:buku@localhost:5432/buku` and `DEMO_MODE=false` | local `buku` |
| Production (real workspace) | https://native-erp-v2.vercel.app (invitation login) | Neon `real-data` |
| Staging (synthetic pre-production) | Vercel → Deployments → branch `staging` (Vercel login + invitation login) | Neon `preview` |

New work merges into `staging` first. Promote tested staging through a separate PR to `main` using a merge commit; do not push production into staging after every feature. See [Branch workflow](../README.md#branch-workflow).

The `native-erp-v2-git-real-data-…vercel.app` domain still points at git branch `staging`; it no longer holds client data. Google OAuth for Drive must list the production callback URL.

Neon connection strings for every branch are in `.env.neon.local` (gitignored, not auto-loaded). Never point `.env`
at Neon `production` or `real-data`, because `npm run demo:reset` truncates whatever `DATABASE_URL` points at.

# Testing with real client statements

Real bank statements are client data (NDA, UU PDP). This page says where they may go and how to take one from
file to a closed month.

## Rules
1. **Never** upload real files to the public demo (https://native-erp-v2.vercel.app). It has no login, and *Reset data demo* wipes it.
2. Real data lives in exactly two places:
   - **Local**: Postgres on your machine. Files go in `data/private/` (gitignored).
   - **Private preview**: the Vercel Preview for git branch `real-data`. It sits behind Vercel login, uses Neon branch `real-data`
     and runs with `DEMO_MODE=false` (no demo firm, no reset button).
3. Never commit a statement, a screenshot of one, or `inspect:statement` output. Tests use synthetic fixtures (`tests/pdf-fixture.ts`).
4. With an AI key set, *unrecognised* lines go to the AI gateway (OpenCode Zen): the merchant key, the first 80 characters
   of the description, and the client's name and business type. Lines matched by transfers, rules or memory are never sent.
   Leave the key empty for rules-only.
5. PDF passwords are used once to open the file. They're never stored or logged.

## 1. Check the file before importing (no database)
```bash
npm run inspect:statement -- data/private/bca-agustus.pdf
PDF_PASSWORD=01011980 npm run inspect:statement -- data/private/mandiri.pdf   # password-protected PDF
npm run inspect:statement -- data/private/bri.pdf --lines                       # raw PDF text with x positions
```
Look for `Kesinambungan NYAMBUNG ✓`. That means opening + every row = every printed balance = closing, so no row was
lost or misread. `ADA CELAH ✗` names the broken rows. Exit code 2 means a gap.

Supported: text PDF e-statements (BCA / Mandiri / BRI-style layouts), KlikBCA CSV, Mandiri XLSX, BRI CSV, and any CSV/XLSX
with tanggal / keterangan / debet-kredit (or mutasi) / saldo columns.
Not supported: scanned PDFs (no text layer) and `.xls` (save as `.xlsx`). Both get a clear message.

**If a format fails**, send only the column header line and one anonymised row from `--lines`, with amounts and names
changed. That's enough to add the layout.

## 2. Add the client
Beranda → **Tambah klien**. Enter the client (group) name and business type, then one entity per company or person
that holds bank accounts (PT/CV first, then the owner). Add each bank account with its number as printed on the statement.
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

## Environments
| Where | How to open | Database |
|---|---|---|
| Local | `npm run dev` with `.env` → `postgresql://buku:buku@localhost:5432/buku` and `DEMO_MODE=false` | local `buku` |
| Private preview | Vercel → project → Deployments → branch `real-data` (log in to Vercel) | Neon `real-data` |

Keep `real-data` in sync with `main` after each merge:
```bash
git push origin main:real-data
```

Neon connection strings for every branch are in `.env.neon.local` (gitignored, not auto-loaded). Never point `.env`
at Neon `production` or `real-data`, because `npm run demo:reset` truncates whatever `DATABASE_URL` points at.

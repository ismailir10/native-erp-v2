# Chickin group demo (private)

A 10-minute walk through a real multi-company, multi-currency group. **Run it locally or on the `real-data` preview only**
(behind Vercel login). The numbers are client data: they appear on screen, never in this repo.

## Before
```bash
npm run verify:real -- chickin --into-app   # loads "Chickin Group" into the firm the app shows, prints the checks
```
Needs `data/private/chickin.xlsx` and `data/private/rates.csv` (SGD→IDR rates, confirmed by the owner). The script uses rules
for account mapping (no AI credit). For the live AI moment, leave a few accounts unmapped and use *Minta saran AI*.

## Walk
1. **Impor → Buku besar / neraca → the import of `20_OPCO_GL_MASTER`.** "Four companies, three years, one file." Point at the
   checks: the CSP batch that doesn't balance by Rp 5.000.000, reused account codes (21001), balances against their nature.
   "These are the consultant's own findings — Buku found them before posting anything."
2. **The HoldCo import (`10_HC_GL_MASTER`).** SGD books with USD and IDR lines written as if they were SGD: *baris IDR di buku
   SGD dicatat apa adanya tanpa kurs*. "An IDR loan sitting in a Singapore dollar ledger."
3. **Pemetaan akun.** ~700 accounts, almost all mapped by rules; show the source code and the Buku account side by side.
4. **Neraca Saldo → Akun sumber**, one company at a time. "Their own chart, their own codes — matches their ledger to the sen."
5. **Pick HoldCo.** Everything in SGD.
6. **Laporan Keuangan → Gabungan Grup.** Rupiah, translated, *Selisih penjabaran mata uang asing* on its own line. Hover the ⓘ:
   management view, not SAK consolidation.
7. **Kurs.** Where the rates come from, and what happens when one is missing (*belum dijabarkan*, never a guess).
8. **Buku Besar → any line.** The sheet opens the file row it came from (`20_OPCO_GL_MASTER!…`).
9. **Tutup Buku.** The import control: FAIL while the accepted Rp 5.000.000 difference sits in 1999.

## Not in this demo
Intercompany matching between the companies (next cycle), AI review/commentary, SAK consolidation.

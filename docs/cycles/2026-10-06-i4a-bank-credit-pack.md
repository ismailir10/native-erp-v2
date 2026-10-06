# I4a — Paket Kredit Bank

## Context
ADR 0014 orders the report packs: Pajak, SAK, **Bank**, Management. An Indonesian bank reviewing an SME credit application (KUR, KMK,
KI) asks for:
- financial statements;
- 6–12 months of rekening koran;
- the receivables and payables lists;
- the asset list (collateral).

The bank's analyst then checks one thing first: do the bank deposits support the revenue the statements report? The firm can answer
that before the analyst asks, and Buku is the only tool that can show where every number came from.

Buku already computes every piece except the deposits-versus-revenue tie:
- the statement set (`financialStatementsWorkbook`);
- aging (`invoicesAt`, `agingByContact`);
- the asset register (`assetRegister`).

This cycle bundles them into one workbook per company. It is the bank pack from the plan. The tax pack (I4 #1) needs the PPh 21 TER
and Unifikasi scope decision first. Approved under "get them done" (2026-10-06).

## Spec
- [ ] **One Excel workbook per company and month**: `GET /clients/[id]/reports/export/credit?entity=<id>&period=YYYY-MM`. It refuses
  a combined scope or a non-IDR company in plain Bahasa. The sheets, in order:
  1. **Ringkasan**: company, period, and *final* or *draf* with the reasons (as the statements).
     - Key figures from the books:
       - Pendapatan and Laba bersih for the fiscal year to date;
       - Kas & bank, Total aset, Total liabilitas and Ekuitas at the month end.
     - A note that the bank computes its own ratios.
     - The list of sheets.
  2. **The statement set**, unchanged: the same sheets as *Unduh Excel*, from the same `statementSet` and never a second computation.
  3. **Mutasi vs Omzet**: the last 12 months up to the period (from the company's first bank month).
     - Columns:
       - money in on its bank accounts;
       - less transfers between own accounts (1199 / 1190);
       - less loans & capital (lines classified to a LIABILITAS or EKUITAS account);
       - less *belum diklasifikasi* (1999 or still in review);
       - = *penerimaan usaha*;
       - *pendapatan* from Laba Rugi;
       - the ratio.
     - A note says receipts include PPN and collections of earlier sales, so a ratio around 1,0–1,15 is normal for a PKP.
     - Split lines count by their parts.
  4. **Umur Piutang / Umur Utang** at the month end (`agingByContact`). When there are no invoices, the sheet says so.
  5. **Aset Tetap**: the register at the month end (cost, accumulated depreciation, book value; from the GL). When there are none,
     the sheet says so.
  6. **Jejak Sumber**, per account with a balance or movement:
     - the year-to-date balance;
     - how many journal lines came from rekening koran rows, ledger file rows, Saldo Awal, and adjustments or manual journals.

     The heading says every number in Buku can be traced to its row, and how.
- [ ] **On Laporan Keuangan**, a *Paket kredit bank (Excel)* download next to the existing ones, for a single company. The download is
  logged as `REPORT_EXPORT` ("Paket kredit bank"), so it counts as *terkirim* (I0, I5a).
- [ ] Every amount is a bigint, written to Excel as in the statements workbook (numbers within 2^53, text beyond). Nothing is stored.

**Non-goals:**
- PDF of the pack;
- ratio analysis beyond the note;
- cash-flow projections (KI);
- the bank's own templates;
- multi-company consolidation.

**Gate-reopeners:** none.

**Assumptions:**
1. The pack is for one company: the borrower. A group's owner is a separate company.
2. Twelve months back from the period, starting no earlier than the company's first bank statement.
3. "Penerimaan usaha" is a deterministic reading of how lines were classified. It is not a judgement, and the sheet says which lines
   were left out and why.

## Tasks
- [ ] T1 `lib/reports/credit.ts`: `receiptsVsRevenue` (pure aggregation over bank lines + `incomeStatement`) and `sourceTrail`
  (grouped journal lines). DB tests on the group fixture (transfer, loan, split, unreviewed line, revenue month).
- [ ] T2 `creditPackWorkbook` (reuses the statements workbook builder; adds the sheets) + the route + `REPORT_EXPORT` + download button.
  DB test that the workbook opens with the expected sheet names and figures.
- [ ] T3 Gates. Accept: lint, typecheck, test, build and verify:books pass (e2e in CI).

## Implementation
## Verification
## Ship Notes

# I4b — Laporan manajemen bulanan

## Context
ADR 0014's fourth pack is the monthly management report. It is what a firm sends a client's owner each month: how the month went,
what moved, and how much cash is left. Today the accountant writes it by hand in Excel or WhatsApp from Buku's statements.

Buku already computes everything it needs:
- the Laba Rugi per month;
- the ledger flux scan (`scanLedger`, accounting-rules 22b: each account against its usual month);
- cash from the trial balance.

The commentary can be **deterministic**: sentences built only from those computed numbers. This follows ADR 0014's AI pattern. An
AI-drafted version (I5) can later rephrase these sentences, but must never introduce a number they don't hold.

Approved under "get them done" (2026-10-06).

## Spec
- [x] **One Excel workbook per company and month**: `GET /clients/[id]/reports/export/management?entity=<id>&period=YYYY-MM`. A single
  company only (combined scope refused in Bahasa). It works in any currency: amounts are formatted in the company's own.
  1. **Ringkasan**:
     - this month, last month, the change, and the financial year to date for:
       - Pendapatan, Laba kotor, Laba bersih;
       - Margin kotor % and Margin bersih %;
       - Kas & bank at the month end.
     - *Catatan bulan ini*: three to six sentences built from those numbers:
       - revenue up or down against last month, with the amount and %, worded true in either direction;
       - net profit or loss;
       - cash up or down;
       - the largest movers from the flux scan, by name and amount.
     - Draft months say *draf* in the title block.
  2. **Perubahan Akun**: every P&L account that moved this month or in the baseline:
     - this month, the baseline average (the up to three active months before);
     - the difference, and the % when there is a baseline;
     - sorted by the size of the difference.
- [x] **On Laporan Keuangan**, a *Laporan manajemen (Excel)* download for a single company, logged as `REPORT_EXPORT` ("Laporan
  manajemen").
- [x] Every sentence is pure and testable (`lib/reports/management.ts`). No AI call, nothing stored.

**Non-goals:**
- PDF;
- charts in the workbook;
- budgets and targets (Buku has none);
- AI rewording (I5);
- the investor pack (deferred in ADR 0014).

**Gate-reopeners:** none.

**Assumptions:**
1. "Last month" is the calendar month before. The year to date follows the client's tahun buku.
2. A margin is shown only when revenue is positive.
3. Movers are named only when the flux scan flags them (≥ materiality and ≥ 50 % off the baseline), so the commentary never
   highlights noise.

## Tasks
- [x] T1 `lib/reports/management.ts`: `managementSummary` (figures + movers) and `commentary` (sentences) + tests (up, down, a loss, no
  revenue, a mover named). Accept: tests pass.
- [x] T2 `managementWorkbook` + route + `REPORT_EXPORT` + button + e2e download check. Accept: DB test opens the workbook; e2e in CI.
- [x] T3 Gates. Accept: lint, typecheck, test, build and verify:books pass.

## Implementation
- Plan: T1–T3 sequential, inline.
- T1: `lib/reports/management.ts`:
  - `managementSummary`: month, last month and year to date from `incomeStatement`; cash from `trialBalance`; movers are the P&L
    flux findings of `scanLedger`; *Perubahan Akun* comes from its series against the active-month average.
  - `percentOf`; `commentary`, sentences true in either direction (naik/turun, bertambah/berkurang, laba/rugi).
  - `tests/unit/management-commentary.test.ts`.
- T2: `lib/reports/management-pack.ts` (`managementWorkbook`: Ringkasan with *Catatan bulan ini* and the figures table, Perubahan
  Akun), the route `app/(app)/clients/[id]/reports/export/management/route.ts` (single company, any currency; logged as
  `REPORT_EXPORT` "Laporan manajemen"), and the *Laporan manajemen* button on Laporan Keuangan. Tests: `tests/db/management-pack.test.ts`;
  the statements e2e downloads it.
## Verification
- Demo data, August 2026 commentary:
  - PT Ayam: "Pendapatan … Rp 1.505.720.721, naik Rp 69.594.595 (4,8 %)", net margin 11,3 %, cash up Rp 36.675.000.
  - CV Sinar Retail: revenue up 10,9 %, net margin 24,3 %.
  - PT Jasa Kreatif: "turun Rp 59.414.415 (32,5 %)", net margin 13,7 %.
  - No movers: the demo's months are steady, so the flux scan flags nothing, and the commentary names nothing.
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 170 passed (170), Tests 1119 passed (1119);
  `npm run build` exit 0; `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
  E2e in CI.
## Ship Notes
- No migration or env var. New route `/clients/[id]/reports/export/management`. Rollback: revert.

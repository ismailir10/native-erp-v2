# Non-calendar financial year (tahun buku)

## Context
Use-case feedback (the owner's "Use Case Mendalam Uji Aplikasi Buku"): Chickin closes its books on **31 January**. Every year-to-date
figure in Buku starts on 1 January, because the code hard-codes `dateOnly(year, 1, 1)` and `dateOnly(year - 1, 12, 31)` in about 40
places:
- the TB fold of earlier years' P&L into Saldo Laba (`lib/reports/ledger.ts` `nativeTrialBalance`);
- equity changes and cash flow openings (`lib/reports/statements.ts`);
- CALK and the Excel/PDF set (`notes.ts`, `statement-set.ts`);
- the reports page, the account ledger and the source TB;
- the asset register, benefits valuation, inventory count check and ledger-import default opening;
- the December close controls.

For Chickin, a statement for Agustus 2026 should run from 1 Februari 2026. The Neraca's *laba berjalan* should hold Feb–Agu only, with
January 2026 (the last month of the year ending 31 Jan 2026) in Saldo Laba. Today January lands in this year and the comparatives are
calendar years.

The GL folding is derived at read time (rule 1: no closing entries), so a year start per client is enough. Nothing is posted differently.

## Spec
Approval: the owner asked to ship cycle 6 and start this one, under the standing "get them done" for the planned cycles. The assumptions
below are reported back; correct any and the cycle follows.

- [ ] **Akhir tahun buku per client.**
  - `Client.fiscalYearEndMonth` (1–12, default 12, DB CHECK) is set in *Pengaturan klien* ("Tahun buku": Januari–Desember, showing
    "1 Februari – 31 Januari"). All entities of a client share it, like its chart and report format.
  - Changing it moves no posted figure, only the year reports count from. It is refused once any month of the client is closed
    ("Tahun buku tidak bisa diubah setelah ada bulan yang ditutup. Buka kunci dulu."), so closed statements never change underneath.
  - The change is recorded in the client's history.
- [ ] **One helper.** `lib/fiscal.ts`:
  - `financialYear(endMonth, year, month)` → `{ start, end, startYear, endYear }` for the financial year holding that month;
  - `fiscalYearStart(endMonth, date)`, `priorYearEnd`, and `fiscalLabel` ("2026" for a calendar year, "2026/2027" otherwise);
  - `fiscalEndMonth(db, clientId)`.

  Every former 1-Jan / 31-Dec site reads it.
- [ ] **Ledger reports.**
  - The TB folds P&L before the financial-year start into Saldo Laba; the Neraca's *laba berjalan* holds the financial year to date.
  - The account ledger counts P&L from that start, and so does the source TB.
  - Equity changes and cash flow open at the day before the financial-year start, plus that year's Saldo Awal.
  - The checks against the Neraca still hold.
- [ ] **Statements, page, Excel, PDF.**
  - Laba Rugi YTD runs from the financial-year start, against the same months of the previous financial year.
  - Neraca comparatives are last month and the previous financial-year end.
  - Labels say "S.d. Agustus 2026" (unchanged), the period "1 Februari – 31 Agustus 2026", and the Neraca column "31 Jan 2026".
  - CALK sentences ("periode 1 Februari 2026 – 31 Agustus 2026") follow.
  - Calendar-year clients see exactly what they see today.
- [ ] **Registers and controls.**
  - Asset register: "disposed this year" and depreciation to date follow the financial year.
  - Benefits valuation opens at the previous financial-year end and takes expense to date from the start.
  - Inventory's COGS check follows the financial year.
  - The benefits close control runs in the financial-year end month.
  - Ledger import's default opening is the day before the financial-year start.
- [ ] **Pajak Badan stays calendar for now, and says so.** For a non-calendar client:
  - the tax pack page shows "Pajak Badan untuk tahun buku non-kalender belum didukung di Buku; hitung PPh badan di luar Buku untuk
    sementara." instead of a calendar-year computation;
  - the December tax control is not run;
  - the CALK tax note is replaced by a *[isi oleh manajemen: …]* marker.

  This avoids a wrong year rather than half-supporting it.

**Non-goals:**
- PPh badan by tahun buku (`TaxYear` naming, PPh 25 credits by masa, compensation years, December locks): a follow-up cycle.
- A year-end change mid-history (a transition year shorter or longer than 12 months).
- 52/53-week years.
- Different year ends inside one client.
- Setting the year end on *Tambah klien* (settings only).
- Closing entries.

**Gate-reopeners:**
- Schema migration `Client.fiscalYearEndMonth Int @default(12)` + CHECK (additive).
- Accounting rule 1 gains: "the year" is the client's financial year.

**Assumptions:**
1. The year end belongs to the client, not the entity (a group shares one).
2. Calendar-year clients are untouched (default 12, every helper returns today's dates), so `verify:books` and the e2e walks don't
   change.
3. The year is named by its months ("Tahun buku 2026/2027", Feb 2026–Jan 2027); "S.d. Agustus 2026" stays the YTD column label.
4. Locking a month freezes the year end (a closed set of statements never changes underneath).

## Tasks
- [x] T1 `lib/fiscal.ts` + `Client.fiscalYearEndMonth` (migration, CHECK) + settings field + action + history. Accept: unit tests for
      every end month (start, end, the month that wraps, leap February); DB test: set, refused after a lock, recorded.
- [x] T2 Ledger core: TB fold, account ledger, source TB, equity changes and cash flow openings. Accept: DB test for a 31 January
      client with Jan and Feb 2026 entries: TB at Agu 2026 has January's P&L in Saldo Laba, and equity changes and cash flow tie to the
      Neraca. Calendar clients are unchanged (existing tests).
- [ ] T3 Statements: reports page, `statement-set` (Excel, PDF), CALK. Accept: DB test of columns, comparatives and labels for the
      31 January client; existing statement tests pass unchanged.
- [ ] T4 Registers and controls: asset register, benefits valuation and control, inventory, ledger-import default opening, tax pack
      notice, tax control and CALK tax note. Accept: DB tests per site for the 31 January client.
- [ ] T5 Rule 1 amendment, README, end-of-cycle gates, review pass, ship.

## Implementation
- T1:
  - `lib/fiscal.ts`: `financialYear`, `fiscalYearStart`, `priorYearEnd`, `samePeriodLastYear`, `fiscalLabel`, `fiscalSpan`,
    `fiscalEndMonth`.
  - `Client.fiscalYearEndMonth` with migration `20261003070000_fiscal_year`, which adds the column (default 12) and a CHECK 1–12.
  - `setFiscalYearEnd` in `lib/entity-settings.ts`: refused once any month is LOCKED (naming the latest one), a no-op for the same value,
    history kind `FISCAL_YEAR`.
  - `saveFiscalYearEndAction`; `FiscalYearCard` on client settings (12 options "1 Februari – 31 Januari"; disabled with the reason once a
    month is closed; notes that Pajak Badan is calendar-only).
- T2:
  - `nativeTrialBalance` folds P&L from before `fiscalYearStart(endMonth, asOf)`.
  - `accountLedger` counts P&L openings from the financial-year start (`fiscalEndMonthOfEntities`, since it has no client at hand), and
    so does `sourceTrialBalance`.
  - `equityChanges` and `cashFlow` open the day before the financial-year start.
  - Comments that said "1 January" / "31 December" now say financial year.

## Verification
- T1: `tests/unit/fiscal.test.ts` (4) + `tests/db/fiscal-settings.test.ts` (1) → `Tests 5 passed (5)`. Migration applied to both DBs.
  Lint + typecheck clean; `npm test` → `Test Files 153 passed (153) · Tests 1032 passed (1032)`.
- T2: `tests/db/fiscal-ledger.test.ts` → `Tests 2 passed (2)`. For a 31 January client at Agu 2026:
  - 4100 = 40 jt and 3200 = 100 jt (January folded); laba berjalan 30 jt; Neraca balances;
  - equity changes open on 31 Jan 2026 at 600 jt and close at 630 jt = Neraca; cash flow 600 → 630;
  - account ledger opening 40 jt; source TB 40 jt; January's own TB is still 100 jt.

  The calendar client keeps 140 jt in 4100 and 0 in 3200. Lint + typecheck clean; `npm test` →
  `Test Files 154 passed (154) · Tests 1034 passed (1034)`.

## Ship Notes

# Laporan keuangan lengkap — pembanding, PKL, perubahan ekuitas, arus kas, CALK, unduhan

## Context
Last of the five Balancio-gap cycles (approved "all in that order"). Buku's promise is *rekening koran in → laporan keuangan out*, but
Laporan Keuangan stops at Laba Rugi (month + year to date) and Neraca (vs last month). A set a client can sign under SAK EP also needs the
prior-year comparatives, other comprehensive income (the PSAK 24 remeasurement now lands in 3920), the statement of changes in equity, the
statement of cash flows and the notes (CALK), plus the directors' statement — and the accountant wants it as one file.

## Spec
- [ ] **Comparatives:** Laba Rugi gains *s.d. the same month last year*; Neraca gains *31 Desember last year* (besides last month; one column
      when they coincide).
- [ ] **Penghasilan komprehensif lain** under Laba bersih: the period's movement of the PKL equity lines (3920 remeasurement of employee
      benefits, net of the deferred tax booked there) → *Total penghasilan komprehensif*.
- [ ] **Laporan Perubahan Ekuitas** (year to date, single-currency scopes): per equity FS line (Modal, Saldo laba, Pengukuran kembali
      imbalan kerja, Selisih penjabaran, Prive) — saldo 1 Januari, laba tahun berjalan, penghasilan komprehensif lain, setoran / penarikan modal,
      prive, dividen & koreksi saldo laba, saldo akhir. Opening + movements = the Neraca's equity (checked, shown).
- [ ] **Laporan Arus Kas, metode tidak langsung** (year to date, single-currency scopes), from the change of every Neraca line since 31
      December: laba bersih; non-cash and working-capital lines (accumulated depreciation, receivables, inventory, prepaid, tax, payables,
      accruals, employee benefits, deferred tax, PKL) → operating; fixed assets (other than ROU), investments and intangibles → investing;
      bank and long-term loans, leases (ROU with its liability, so a commencement is non-cash), intercompany, capital, prive, retained-earnings
      movements → financing. Net change = the change of Kas dan setara kas (checked, shown), with opening and closing cash.
- [ ] **CALK** (tab and in the file): 1 Umum (entity, client, period), 2 Ikhtisar kebijakan akuntansi (SAK EP, accrual basis and the policies
      of the modules in use: aset tetap, CKPN, sewa, imbalan kerja, pajak), 3+ one note per Neraca / Laba Rugi line with its accounts, current vs
      comparative; detail notes from the registers where they exist: aset tetap (cost and accumulated depreciation), piutang usaha (aging and
      CKPN), sewa (aset hak guna, liabilitas jangka pendek / panjang), imbalan kerja (assumptions, DBO, sensitivity), pajak penghasilan (fiscal
      reconciliation, current and deferred tax). Each figure from the same functions as its page.
- [ ] **Surat pernyataan direksi**: the standard statement of responsibility with the entity, period, and blanks for name and signature.
- [ ] **Unduh laporan keuangan (Excel)**: one workbook — Neraca, Laba Rugi (with PKL), Perubahan Ekuitas, Arus Kas, CALK, Pernyataan Direksi —
      built from the same functions; tenant-checked route; IDR as Excel numbers.

**Gate-reopeners (flagged):** none (no schema, no dependency, no AI). New report semantics are covered by accounting rule 12 (reports derived
from the GL); a short note on the cash-flow classification is added to the rules.

**Non-goals:** PDF output and page layout; the direct cash-flow method; a separate OCI item for FX translation in mixed scopes (mixed-currency
scopes get Laba Rugi and Neraca only, as now); free-text editing of the notes inside Buku (the Excel file is the editable copy); segment and
related-party notes.

**Assumptions:**
1. The cash flow classifies by FS line (and the lease, employee-benefit and deferred-tax accounts by code); interest paid inside rent is in
   financing, other interest in operating via profit.
2. Movements of 3200 other than the yearly fold of profit are shown as *dividen & koreksi saldo laba* (financing in the cash flow).

## Tasks
- [ ] T1 Statements `lib/reports/statements.ts` (comprehensive income, equity changes, cash flow) — accept: DB tests on a small book
      (capital, sales on credit, purchase of an asset, loan, depreciation, dividend, a lease, a PSAK 24 journal) proving opening + movements =
      closing and net cash change = Δ cash.
- [ ] T2 Report page: comparatives, PKL, *Perubahan Ekuitas* and *Arus Kas* tabs — accept: e2e on the demo (tabs render, checks pass).
- [ ] T3 CALK + directors' statement `lib/reports/notes.ts` + tab — accept: DB test (sections present, note totals = the statements).
- [ ] T4 Excel workbook + route — accept: DB test reads it back (sheet names, key totals = the statements); e2e download.
- [ ] T5 Rules + docs — accept: end-of-cycle gates.

## Implementation
## Verification
## Ship Notes

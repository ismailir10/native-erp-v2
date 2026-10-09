# Report pack a partner signs: periods, comparatives, wording and layout of the PDF / Excel set

## Context
A partner-style review of the downloaded report set (PDF + Excel) for three demo entities: CV Sinar Retail, July 2026, closed; PT Jasa
Kreatif Digital, August 2026, closed; PT Ayam Nusantara Digital, August 2026, open. The reviewer rendered every page, recalculated the
workbooks and acted as the KAP partner who signs before a set goes to a client or a bank. **The numbers tie everywhere**: the Neraca
balances, net profit flows through Perubahan Ekuitas into equity, Arus Kas ends at the Neraca's cash, note totals equal the face lines,
the xlsx equals the PDF and its formulas evaluate to what is shown. The partner still would not send the set. The faults are in
presentation and in period logic that the page already gets right but the export does not:

1. **Periods disagree inside one set.** Laba Rugi, Perubahan Ekuitas and Arus Kas read "Untuk periode 1 Januari – 31 Jul 2026", but
   the books start with a Saldo Awal on 28 Feb 2026 (Perubahan Ekuitas and Arus Kas open at "Saldo 28 Feb 2026", and CALK note 1 says
   "1 Maret – 31 Jul 2026"). Short and long month names are mixed in formal headings.
2. **Comparative columns of dashes.** The Neraca compares with "31 Des 2025", which is all "–" (the books start in 2026). The Laba Rugi
   compares with "1 Jan – 31 Jul 2025", also all "–". A bank reads a column of dashes as a zero-balance prior year. The page
   (`reports/page.tsx`) already shows a comparative only where the books hold data, with the Saldo Awal position in place of the year
   end. `statement-set.ts` and `notes.ts` repeat the date logic without that rule.
3. **App instructions and draft marks in a closed set.** The CALK income-tax note says "Catat jurnalnya di Pajak Badan sebelum laporan
   ini final" in a month that is closed. The workbook's CALK subtitle always ends "(draf)".
4. **PDF layout.**
   - A note's heading and column header end a page while its rows start the next one, with no repeated header, and the first row prints in
     italics (the page header's oblique font leaks).
   - After an *[isi oleh manajemen: …]* blank, the closing "." lands alone on its own line.
   - The full draft to-do list repeats on every page, the Surat Pernyataan included.
5. **Arus Kas.**
   - Internal account codes are printed in the line labels ("Piutang usaha (1130)").
   - There is no *Penyesuaian* / *Perubahan modal kerja* structure, so depreciation sits among the working-capital lines.
   - A loan given to a related party (1190 with a debit balance) is shown as financing.
6. **Wording.**
   - "Total aset" and "Total liabilitas & ekuitas" should be *Jumlah aset* and *Jumlah liabilitas dan ekuitas*.
   - The CALK *Beban lain-lain* note prints expenses in parentheses, while every other expense note prints them positive.
   - The workbook prints over many pages because fit-to-width is set without `fitToPage`.

Who feels it: the accountant sending the set, and the bank or client reading it. This is the deliverable, so it has to look like a
KAP's work.

Approval: the owner's brief in-session ("continue improving Buku until we are proud with our work").

## Spec
- [x] **P1 One period rule for page, PDF, Excel and CALK** (`lib/reports/periods.ts`):
  - The year-to-date start is the books' start when a Saldo Awal opens them inside the year (nothing before it), else the
    financial-year start.
  - The Neraca comparative is the previous year end when the books hold entries by then. Otherwise it is the Saldo Awal position
    (labelled *Saldo awal <date>*) when that falls between the year end and this month. Otherwise there is none.
  - The Laba Rugi comparative (same months last year) appears only when those months hold entries.
  - The page, `statementSet` and `financialNotes` all use it. Formal headings use full month names ("31 Juli 2026").
- [x] **P2 A closed set reads as one.**
  - The CALK subtitle carries "(draf)" only while the set is a draft.
  - The income-tax note never instructs the app user. While the current tax is not journaled it reads as a disclosure: "Beban pajak
    penghasilan kini periode ini belum dicatat dalam laporan laba rugi; estimasinya disajikan di bawah."
- [x] **P3 PDF layout.**
  - A note heading stays with its table's column header and at least two rows.
  - A table or statement that continues on a new page repeats its column header and keeps its row font.
  - Punctuation after a management blank stays on its line.
  - The full draft list prints on the first page only; later pages carry "DRAF — lihat halaman 1".
- [x] **P4 Arus Kas.**
  - The export prints labels without account codes. The page keeps them, as it is for drill-down.
  - The operating section reads Laba bersih → *Penyesuaian:* (depreciation, non-cash and deferred items) → *Perubahan modal kerja:*
    (the rest) → *Kas bersih dari aktivitas operasi*.
  - An intercompany account with a debit balance at the period end is *Pinjaman kepada pihak berelasi* (investing). With a credit
    balance it is *Pinjaman dari pihak berelasi* (financing).
  - The totals and the check against the Neraca's cash are unchanged.
- [ ] **P5 Wording and print.**
  - The default format says *Jumlah aset*, *Jumlah liabilitas* and *Jumlah liabilitas dan ekuitas*. A client's saved format keeps its own
    labels.
  - The CALK expense notes print expenses positive, *Beban lain-lain* included.
  - Every workbook sheet prints one page wide (`fitToPage`).

**Non-goals:**
- Accruing income tax monthly (the December control stays as is).
- A cover page or table of contents.
- An aset tetap movement schedule.
- A *Catatan* column on the face statements.
- Changing any figure. P4 moves one intercompany line between sections; the section totals still add up to the change in cash.

**Gate-reopeners:** none: no migration, dependency, or AI call. `verify:books` must stay ALL PASS. No number moves, only where and how
it prints.

**Assumptions:**
1. "Holds data" means a `JournalLine` of the scope's entities on or before the date (a Saldo Awal counts), the same test the page uses
   today.
2. A client who saved their own report format keeps "Total …" if they wrote it. Only the default changes.
3. Interim wording "Laba (rugi) tahun berjalan" stays. It is the common label in Indonesian interim sets, and the partner listed it as
   optional.

## Tasks
- [x] T1 `lib/reports/periods.ts` + page, statement-set, notes on it; full month names in formal headings. Accept: a db test where a
  client opens with a Saldo Awal on 28 Feb: the set's Laba Rugi is "1 Maret – 31 Juli 2026" with no prior column, the Neraca compares
  with "Saldo awal 28 Februari 2026" (not dashes), and the CALK agrees. The existing statements/report-pdf tests stay green.
- [x] T2 Status-aware CALK wording (xlsx "(draf)", the tax note). Accept: unit/db test that a closed month's workbook and notes carry no
  "draf" and no "Catat jurnalnya".
- [x] T3 PDF layout fixes. Accept: a db test on extracted PDF text (header repeated on a continued note page, no line that is only
  "."). The rendered pages are inspected by eye.
- [x] T4 Arus Kas presentation + intercompany by side. Accept: db test (a debit 1190 → investing, credit → financing; the totals still
  equal the change in cash); export labels carry no "(1130)".
- [ ] T5 Wording + print (Jumlah …, expense-note signs, `fitToPage`). Accept: the updated tests; the workbook's sheets have
  `fitToPage`.
- [ ] T6 End-of-cycle gates. Re-download the three packs and look at every page. Ship Notes.

## Implementation
- Plan: T1–T6 sequential, inline (all in `lib/reports/*` and the PDF writer, each building on the last).
- T1: `lib/reports/periods.ts` (new: `reportPeriods` — books' start, year-to-date start, the Neraca comparative = previous year end with entries
  or the Saldo Awal position, the same months last year only with entries), used by `statement-set.ts` (subtitles, columns, OCI prior),
  `notes.ts` (note columns: two only with a comparative; note 1's period; every date in full: "31 Juli 2026"), `reports/page.tsx` (its own
  copy of the rule replaced), `pdf.ts` (CALK and Surat Pernyataan dates). Tests: `tests/db/report-periods.test.ts` (new, 2), wording updated in
  `statements`, `fiscal-statements`, `notes-manual`, `report-pdf` tests.- T2: `notes.ts` (the unbooked current tax is disclosed — "Beban pajak penghasilan kini periode ini belum dicatat …; estimasinya disajikan
  di bawah." — not "Catat jurnalnya di Pajak Badan sebelum laporan ini final"), `workbook.ts` (CALK subtitle "(draf)" only with `meta.draft`;
  `newWorkbook` returns `draft`). Test: `tests/db/report-final-wording.test.ts` (new, 2).- T3: `pdf.ts` (a note heading keeps its first paragraph or its table's header and two rows; a table continued on a new page repeats its
  column header; the row font is set after a page break, so the page header's italics no longer leak; a management blank keeps the
  punctuation after it; the draft reasons on page 1, "DRAF — lihat halaman 1" after; statement and note columns wide enough for
  "1 Januari – 31 Maret 2026" on one line), `statement-set.ts` (no OCI in the period: one "Penghasilan komprehensif lain –" line instead of
  an empty heading). Tests: `tests/db/report-pdf-layout.test.ts` (new: 70-account note across pages), `report-pdf.test.ts` (draft line per
  page). Pages rendered and looked at.- T4: `statements.ts` (`cashLine(a, lentOut)`: an intercompany account with a debit balance at the period end → *Pinjaman kepada pihak
  berelasi*, investing; else *Pinjaman dari pihak berelasi*, financing — one `lineOf` inside `cashFlow` for every use, so the non-cash
  and disposal paths agree), `statement-set.ts` (export labels without codes; Laba bersih → *Penyesuaian:* → *Perubahan modal kerja:*).
  The page keeps its codes for drill-down. Test: `tests/db/cashflow-presentation.test.ts` (new, 2: both sides, totals = change in cash;
  export order, no codes).
## Verification
- T1: lint clean · typecheck clean · `npm test` 195 files, 1311 passed.
- T2: lint + typecheck clean · report-final-wording, statements, report-pdf: all passed (full suite at T3).
- T3: lint clean · typecheck clean · `npm test` 196 files, 1312 passed.
- T4: lint clean · typecheck clean · `npm test` 197 files, 1314 passed · `demo:reset && verify:books` → ALL PASS — 1765 (a run on the
  e2e-touched demo first showed CV Sinar 6190 off; reset → ALL PASS: data left by the e2e walk, not this change).
## Ship Notes

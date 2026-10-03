# Report format per client, Excel with formulas, PDF (use-case feedback, cycle 6)

## Context
UC-K3 of the owner's use-case document: a client's statements follow *its own* latest final report — account names, order, grouping,
titles, subtotals — and are never redesigned; the FS mapping is only a bridge. Belifi uses bank-accounting style ("JUMLAH" rows, Laba Kotor
= Penjualan − HPP, negatives in parentheses).

Pass criteria:
- the layout and labels equal the final reference, and one client can differ from another;
- comparatives show;
- negatives are in parentheses and the unit is clear (Rupiah or thousands);
- the Excel export keeps its formulas;
- a PDF is ready to send;
- CALK is filled from data, with the manual parts marked.

Traps: redesigning names or order, and a report that drops unmapped accounts.

A second-model gap analysis read the reports code and probed it. Passing today:
- negatives in parentheses (page and Excel);
- equity, cash flow and CALK exist;
- Neraca comparatives.

Failing:
- **Format is Buku's, not the client's.** Line labels are constants (`FS_LINES`); section titles and totals are typed in the page and the
  workbook. No client can have its own labels, order or subtotals.
- **Excel has no formulas** (0 formula cells: every subtotal is a precomputed number) and no unit line.
- **No PDF** (no library, no print styles).
- **The Laba Rugi has no comparative** when the books start this year (the prior-year column needs prior-year entries; there is no
  last-month column).
- **An account with an FS line outside its statement silently drops.** An expense mapped to a balance-sheet line vanishes from the
  Laba Rugi while the Neraca's *laba berjalan* still counts it: two statements disagree without a word. An asset with an unknown line
  drops from the Neraca, which only shows as *Selisih*.
- **CALK manual parts are not marked** beyond going concern and the signatures.

Spec approval: the owner approved the plan naming this cycle (per-client FS template, PDF, Excel with formulas) and said "get them done".
The cycle runs without a separate stop. The new dependency (below) is the only gate-reopener; it serves the approved PDF item.

## Spec
- [ ] **No account ever drops out (trap).**
      - A P&L account whose FS line is not a Laba Rugi line lands on *Pos laba rugi belum terpetakan*: other income or other expense by
        its type.
      - A balance-sheet account whose FS line is not a line of its type lands on *Pos … belum terpetakan* in its section.
      - The report status gets a REVIEW reason naming the accounts, so the draft banner and the close show it.
      - The Laba Rugi's net profit always equals the Neraca's *laba berjalan*.
- [ ] **A format per client (presentation only).** `ReportFormat` (one per client, JSON, validated on save) holds the unit (Rupiah or
      ribuan) and, for the Laba Rugi and the Neraca, an ordered list of lines:
      - *Judul* (a heading);
      - *Pos* (a label for one or more FS lines, with a presentation sign);
      - *Subtotal* / *Total* (a label, a sum of earlier lines with +/−, bold or caps).

      A client without a row uses the **standard format**, derived from today's layout, so nothing changes until someone edits it.
      Numbers stay derived from the GL (rule 1); the format only arranges them. Saving refuses, naming the line, a format that:
      - leaves an FS line out or puts one twice;
      - sums a later line;
      - is a Laba Rugi whose last total isn't net profit;
      - is a Neraca without a total equal to total assets and one equal to total liabilities + equity.

      These are checked symbolically, so they hold for every period.
- [ ] **The page renders the format.** Laba Rugi and Neraca on the reports page follow the client's labels, order, headings and
      subtotals, with the accounts under each line as today. The unit line says Rupiah or *ribuan Rupiah* (thousands round per line for
      display only). The Laba Rugi gains a **last-month column** when last month has entries, beside this month, year-to-date and last
      year.
- [ ] **Excel keeps formulas.**
      - The Laba Rugi and Neraca sheets follow the format: labels, order, headings.
      - Every subtotal and total is a formula over the cells it sums, with its value cached so the file opens with numbers.
      - A unit line under the title.
      - Thousands use a thousands number format.
- [ ] **PDF ready to send.** *Unduh PDF* beside the Excel button produces one document:
      - a header per page (entity, statement, period, unit);
      - the Laba Rugi and Neraca in the client's format;
      - Perubahan Ekuitas, Arus Kas and CALK;
      - a *DRAF* banner while the month isn't closed;
      - page numbers.
- [ ] **Format editor.** *Pengaturan klien → Format laporan*:
      - a line list per statement (label, kind, order up/down, FS lines for a *Pos*, terms for a total, bold);
      - *Kembali ke format standar*;
      - a *source* note ("Laporan Keuangan 2025 final");
      - refusals in Bahasa naming the line.

      A second client is untouched.
- [ ] **CALK manual parts marked.** Akta pendirian, alamat, kegiatan usaha and peristiwa setelah periode pelaporan carry an *[isi oleh
      manajemen: …]* marker, shown in review colour and counted on the CALK tab.

**Non-goals:**
- Non-calendar fiscal year (next cycle; Chickin's 31 January).
- EBITDA and computed KPI lines (UC-A4): a later line kind on the same format.
- Formats for Perubahan Ekuitas and Arus Kas (structural statements), and per-account regrouping (a *Pos* sums FS lines).
- Per-entity formats.
- Free-text CALK editing in Buku.
- Comparing the PDF visually with the client's reference automatically.

**Gate-reopeners (flagged):**
- **Schema migration:** `ReportFormat` (additive).
- **New dependency:** `pdfkit` (pure JS, standard fonts built in, server-side in the export route) for the send-ready PDF. The alternative
  (browser print CSS) is not send-ready: browser headers, no page numbers, a user step.
- **Accounting invariant:** rule 12 (reports) gains: a format is presentation only, and no account may drop out of a statement.

**Assumptions:**
1. A format belongs to the client (all its entities and the combined view share it), like its chart of accounts.
2. Thousands are display and export only: each line rounds half away from zero; totals of rounded lines may differ by a unit from the
   rounded total, as in published statements. The PDF says *dalam ribuan Rupiah*.
3. The standard format reproduces today's page exactly (the e2e walk and the statement tests don't change).

## Tasks
- [x] T1 Never drop: synthetic unmapped lines in `incomeStatement` / `balanceSheet`, REVIEW reason in `reportStatus`. Accept: DB test
      (expense on a BS line, asset on an unknown line → shown, IS net = BS laba berjalan, reason present).
- [x] T2 Format core: `lib/reports/format.ts` (types, standard format, symbolic validation, render to rows) + `ReportFormat` model,
      migration, client delete. Accept: unit tests (standard renders today's totals; a renamed and reordered format renders; each refusal).
- [x] T3 Page from the format: Laba Rugi and Neraca, unit line, thousands, last-month column. Accept: e2e statements walk unchanged;
      DB/unit test of a custom format on the page model.
- [ ] T4 Excel from the format with formulas, unit row, thousands format. Accept: DB test reads formulas back, cached results equal the
      totals, labels in format order.
- [ ] T5 Format editor + server action. Accept: DB tests of save/refuse/reset; visual check.
- [ ] T6 PDF export (pdfkit) + button. Accept: DB test extracts text (labels, period, unit, totals, DRAF).
- [ ] T7 CALK markers, rule 12 amendment, end-of-cycle gates, review pass, ship.

## Implementation
- Plan: T1–T7 sequential, inline.
- T1: `lib/reports/ledger.ts`:
  - `PseudoLine` + `PSEUDO_LABEL`;
  - `isUnmapped` (an account's FS line isn't a line of its type's statement);
  - `unmappedItem` adds *Pos pendapatan / beban belum terpetakan* to the Laba Rugi's other income / other expense, and *Pos aset /
    liabilitas / ekuitas belum terpetakan* to the Neraca's current assets, current liabilities and equity.

  `reportStatus` gains `unmapped` (accounts with lines in scope, by code), and the draft banner links it to client settings. Test:
  `tests/db/report-unmapped.test.ts`.
- T2: `lib/reports/format.ts`:
  - `FormatLine` (HEADING / GROUP / TOTAL) and `ReportFormat`;
  - `standardFormat()` line for line with today's page;
  - `validateFormat`: zod shape, then per statement every FS line exactly once (and synthetic lines), totals only over earlier
    non-heading lines, and per-line coefficient vectors over FS lines (the Laba Rugi's last total = the net-profit vector; the Neraca
    has the assets vector and the liabilities + equity vector);
  - `loadReportFormat` (an invalid stored format falls back to standard);
  - `renderFormat` to FsTable-shaped sections, totals from the rendered lines, and `toUnit` for thousands.

  `ReportFormat` model + migration `20261003060000_report_format`; `deleteClient` deletes it. Test: `tests/unit/report-format.test.ts`.
- T3: the reports page loads the client's format (`loadReportFormat`) and renders the Laba Rugi and Neraca with `renderFormat`:
  - Laba Rugi columns: this month, last month (when it has entries), year to date, the same months last year;
  - the OCI section is appended in the same unit;
  - client-account rows and the unit line ("ribuan Rupiah") are scaled;
  - the card description names a client format and its source.

  `FsTable` draws format sections: review colour by the item's `review` flag (SUSPENSE and the *belum terpetakan* lines), caps totals.
  Test: `tests/db/report-format.test.ts`.

## Verification
- T1: `tests/db/report-unmapped.test.ts` → `Tests 1 passed (1)`; lint + typecheck clean; `npm test` →
  `Test Files 146 passed (146) · Tests 1013 passed (1013)`.
- T2: `tests/unit/report-format.test.ts` → `Tests 4 passed (4)`. Migration applied to both DBs; `prisma migrate diff
  --from-config-datasource --to-schema` → "This is an empty migration." Lint + typecheck clean; `npm test` →
  `Test Files 147 passed (147) · Tests 1017 passed (1017)`.
- T3: `tests/db/report-format.test.ts` → `Tests 1 passed (1)`; lint + typecheck clean; `npm test` →
  `Test Files 148 passed (148) · Tests 1018 passed (1018)`.

## Ship Notes

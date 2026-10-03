# Subledger reconciliation: the client's aging vs the ledger (rekon subledger)

## Context
Use-case feedback UC-A1 ("Rekonsiliasi subledger operasional vs laporan keuangan"), from AMS:
- the operational subledger and the statements disagree: revenue 2023 by 5,2 %, receivables 2023 by −16 % and 2024 by −6 %, payables
  2024 by −21 %;
- open questions: does the aging leave payables out, and why do the 2023 receivables differ?
- hypotheses: year-end cut-off, invoices or advances missing from the aging, adjusting journals, non-trade payables (bank,
  shareholder, accruals) mixed in, PPN and rounding (a Rp 5 difference).

The source is a typical aging export:
- headers on rows 5–7, with buckets Not Yet Due, 1–30, 31–60, 61–90, 91–120 and > 120;
- the "1-30" header turned into a date serial by Excel;
- decimal-comma amounts.

Buku today proves its *own* invoice register against the ledger (`lib/receivables/aging.ts`, accounting-rules 5c). A client's aging
from its own system can't be compared at all. UC-A1's pass conditions:
- the difference per account and per year, with amount, percent and candidate causes (invoices around the year end, advances,
  non-trade accounts);
- each difference traceable to its source rows;
- explained differences closed as Temuan, the rest left OPEN with a question;
- rounding up to a threshold kept apart from real differences.

Traps: the aging doesn't cover all payables, and a Rp 5 rounding must not flood the list.

## Spec
- [ ] **Import an aging** (Piutang & Utang → *Rekonsiliasi*):
  - the input: entity, kind (Piutang / Utang), "per" date, and an XLSX/XLS/CSV file (`asXlsx`);
  - the reader finds the header block (a counterparty column and a total column within the first 15 rows), maps the buckets by text,
    and reads a date or serial header as the "1-30" bucket it was typed as;
  - amounts with a decimal comma round to whole Rupiah per row, and the rounding is noted;
  - total, subtotal and blank rows are skipped; credit rows are kept (signed);
  - each row keeps `sheet!row`;
  - a file without a counterparty or total column is refused, naming what's missing.

  Stored as `SubledgerImport` (entity, kind, asOf, file name, Buku accounts compared, threshold) with `SubledgerRow`s. Removing an
  import removes its rows (and its open Temuan).
- [ ] **Compare with the ledger:**
  - the aging total against the GL balance at the "per" date of the accounts it represents; by default those are all
    accounts on Piutang usaha / Utang usaha (excluding the allowance), editable at import;
  - shown as difference = aging − GL, with percent of GL;
  - within the threshold (default Rp 1.000, editable) it is *Pembulatan* (pass), otherwise *Selisih*;
  - per counterparty: when Buku holds invoices for the entity, the aging row is compared with that counterparty's open items at the
    date (name match, case- and legal-form-insensitive), so the difference narrows to names.
- [ ] **Candidate causes**, each with amounts and drill links, never asserted:
  - **Cut-off:** GL lines on the compared accounts within 7 days either side of the date, with their source (bank row / file row).
  - **Uang muka:** aging rows with a credit balance, and balances on advance accounts (Uang muka / Pendapatan diterima di muka /
    Uang muka pembelian).
  - **Non-trade:** for payables, balances on other liability accounts (Utang lain-lain, Beban masih harus dibayar, Utang bank,
    shareholder/related) with "Aging tidak mencakup akun ini". For receivables, Piutang lain-lain.
  - **Counterparties only on one side:** aging names with no Buku contact, and Buku open items missing from the aging.
- [ ] **Temuan:**
  - a comparison outside the threshold opens one Temuan `SUBLEDGER_DIFFERENCE`, with the difference and a question naming the file,
    date and accounts;
  - re-importing the same entity, kind and date replaces the earlier import, and its still-open Temuan is updated, not duplicated;
  - resolving writes the explanation (min. 10 characters); a correction goes through Jurnal Penyesuaian and the explanation names it
    (review pass: the journal link was dropped, see below); it never posts by itself;
  - an open one shows on the close as a REVIEW control "Rekonsiliasi subledger"; resolved ones stay in the history.
- [ ] **Several years:** imports are listed by date, so 2023 and 2024 sit side by side, each with its own difference and Temuan.

**Non-goals:**
- importing the operational *sales per invoice* file as invoices (UC-B5 territory);
- comparing revenue (subledger sales vs P&L);
- AI explanations;
- auto-posting corrections;
- FX agings (IDR entities only, refused otherwise).

**Gate-reopeners:**
- Schema migration: `SubledgerImport`, `SubledgerRow`, and a `FindingKind` value `SUBLEDGER_DIFFERENCE` (additive).

**Assumptions:**
1. "Per account and per year" = per import (an aging is one kind on one date); the accounts compared are listed with their balances.
2. Threshold default Rp 1.000 per comparison.
3. Name matching is exact after normalising case, spaces and PT/CV/Tbk.

## Tasks
- [x] T1 Model + reader: schema, migration, `lib/reconcile/aging-read.ts`. Accept: unit tests on a synthetic AMS-style file (headers on
      rows 5–7, "1-30" as a date serial, decimal commas, credit row, total row skipped, missing column refused).
- [x] T2 Comparison and Temuan: `lib/reconcile/subledger.ts` (import, compare, candidates, Temuan open/update/resolve, delete). Accept:
      DB tests with three planted differences (cut-off, advance, non-trade payable), a Rp 5 rounding kept as pass, a re-import that
      doesn't duplicate, and resolve text-only.
- [x] T3 UI: the *Rekonsiliasi* tab (upload, list by date, comparison card with candidates and per-counterparty table, Temuan resolve),
      the Temuan card on the close handles the new kind, and the close control. Accept: visual check 1280/390; action tests.
- [ ] T4 Rules, README, gates, review pass, ship.

## Implementation
- T1:
  - Schema:
    - `SubledgerImport` (entity, kind, asOf, file, accountCodes, threshold ≥ 0 CHECK, findingId), unique per entity, kind and date;
    - `SubledgerRow` (position, counterparty, signed total, bucket JSON, `sheet!row`, rounded), cascading with its import;
    - `FindingKind.SUBLEDGER_DIFFERENCE`.
  - Migration `20261003090000_subledger_recon`; client deletion removes the imports.
  - `lib/reconcile/aging-read.ts` `readAging`:
    - reads XLSX/XLS via `asXlsx`, or CSV via papaparse;
    - finds a counterparty column and a total column within the first 15 rows, labelling each column with the two rows above it and
      extending the block downward while rows have text but no name (bucket titles under a merged "Umur");
    - maps buckets by words; a date header of 30 January, or its serial as a number or text, is "1-30";
    - parses amounts with `parseCents`, rounds to whole Rupiah per row and notes it;
    - skips (sub)total rows and empty rows, keeps credits, and records `sheet!row`;
    - refuses a file missing either column, naming the missing one.
- T2: `lib/reconcile/subledger.ts`.
  - `importAging`:
    - checks the kind, the date, an IDR entity, the threshold (default Rp 1.000) and the accounts (default: Piutang usaha with a
      debit balance, or Utang usaha with a credit balance);
    - under the close lock, replaces an import of the same entity, kind and date, stores the rows, and compares;
    - Temuan: a DIFFERENCE opens one, or updates the open one carried from the replaced import; MATCH/ROUNDING closes a carried open
      one, with a resolution naming the new file;
    - writes a `SUBLEDGER` history event.
  - `compareSubledger` reads the GL fresh. It returns aging, ledger, difference, percent (one decimal) and status, the accounts with
    their balances, and the rows. Candidates:
    - GL lines within ±7 days on the compared accounts, largest first, with their source;
    - credit rows in the aging;
    - advance accounts on the other side (by name: uang muka / diterima di muka / dibayar di muka);
    - non-trade accounts with balances (payables: every other liability; receivables: Piutang lain-lain and other trade accounts).

    It also returns counterparty differences against Buku's own open items when Buku keeps invoices for the entity (names compared
    without PT/CV/Tbk, case or punctuation).
  - `resolveSubledgerFinding` takes an explanation of at least 10 characters and optionally a correcting entry of the same entity. It
    posts nothing.
  - `deleteSubledgerImport` closes the import's open Temuan, naming the removed file.
  - Close control "Rekonsiliasi subledger" (REVIEW, ackable) while an open Temuan is dated by the period end. The report-status
    opening-difference reason now counts OPENING_DIFFERENCE Temuan only.
  - The CSV reader picks the delimiter by count (Papa's guess fails on two columns).
- T3: Piutang & Utang gains a third tab, *Rekonsiliasi* (`ReceivablesTabs`, shared with the Piutang/Utang view).
  - Upload card: entity (IDR only), kind, "per" date, threshold, accounts as checkboxes (trade ticked: 1130 for receivables, 2110 for
    payables, plus the other receivable/payable lines to choose from), and the file.
  - One card per import:
    - status pill (Cocok / Pembulatan Rp x / Selisih), aging, GL with per-account links to Buku Besar at that month, and the
      difference with its percent;
    - the Temuan: explanation form, or the closed explanation;
    - candidate sections (± 7 days, advances and credit rows, accounts outside the aging), with hints worded per kind;
    - the per-counterparty table when Buku has invoices, and the aging rows with `sheet!row` (folded);
    - a delete button with a confirm.
  - NextStep names the open Temuan.
  - The close page:
    - the Temuan card labels a subledger difference and links it to Rekonsiliasi instead of a resolve form (one place to explain);
    - the "tutup buku tertahan" NextStep counts opening differences only;
    - the control links to the tab.
  - Actions: `importAgingAction` (FormData, 5 MB), `resolveSubledgerFindingAction`, `deleteSubledgerImportAction`, all
    firm-scoped.

## Verification
- T1: `tests/unit/aging-read.test.ts` → `Tests 3 passed (3)`:
  - an AMS-style xlsx (title rows, headers on rows 6–7, "1-30" as a date, decimal commas, a credit row, a Grand Total row);
  - a semicolon CSV with a text serial;
  - both refusals.

  Lint + typecheck clean; `npm test` → `Test Files 158 passed (158) · Tests 1049 passed (1049)`.
- T2: `tests/db/subledger-recon.test.ts` → `Tests 3 passed (3)`:
  - Receivables: aging 14,5 jt vs GL 17 jt (−2,5 jt, −14,7 %), with the 30 Dec 2 jt line as cut-off, the Toko Lancar −500 rb credit
    row and 2160 500 rb as advance. T-001 opens with the question; a re-import with the missing invoice updates it (−500 rb, still one);
    the third, matching file closes it.
  - Payables: 8.000.005 vs 8.000.000 is ROUNDING with no Temuan; 2120 3 jt is listed as non-trade.
  - Explanation: refused under 10 characters; the close resolves it without posting; the close control shows while it is open.
  - Deleting a 2024 import closes its Temuan.

  Lint + typecheck clean; `npm test` → `Test Files 159 passed (159) · Tests 1052 passed (1052)`.
- T3: the test adds that a subledger Temuan isn't reported as an opening difference. Visual check (dev server, demo Grup Ayam
  Nusantara, Agustus 2026):
  - a CSV aging of 310 jt vs 1130 420 jt shows Selisih (110 jt), −26,2 %, T-001 open, the Toko Sumber Rejeki (10 jt) credit row, and
    1190 under "Piutang di luar aging";
  - the close shows "Rekonsiliasi subledger";
  - at 390 px there is no horizontal scroll.

  Lint + typecheck clean; `npm test` → `Test Files 159 passed (159) · Tests 1052 passed (1052)`.
- T4:
  - Rule 5c amended (a client's own aging is evidence, compared and explained, never posted) and README updated.
  - End of cycle:
    - `npm run lint && npm run typecheck && npm test` → `Test Files 159 passed (159) · Tests 1052 passed (1052)`;
    - `npm run build` passes;
    - `npm run demo:reset && npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`;
    - e2e runs in CI.

## Review pass
An independent review found 15 issues (2 H, 8 M, 5 L), each reproduced with a probe. All fixed:
- **H — total column.** A merged "Total Umur Piutang" title over the buckets made a bucket the total. Now the total column is the last
  non-bucket column labelled total/saldo, and a merged group title (ExcelJS repeats its text in each cell) doesn't count. Rows whose
  buckets don't add up to their total are noted.
- **H — name column.** A title in A1 made the "No" column the names, and "Kode Pelanggan" won over "Nama Pelanggan". Now the header
  row's own "Nama …" comes first, never a code or number column; the stacked label is only a fallback.
- **M — reader:**
  - a summary sheet before the aging won: now the sheet with age columns and the most rows wins, with a note naming it;
  - a formula total saved without its result read 0: the buckets stand in, noted;
  - footer rows after the Grand Total ("Saldo menurut GL", "Selisih") were counterparties: below the grand total only rows with an
    age split count, the rest are noted as skipped.
- **M — supplier advances had the wrong sign**, and "Pajak dibayar di muka" or deposits were advance candidates. Both sides now show
  the advance positive; the pattern is uang muka / diterima di muka / advance / titipan.
- **M — Saldo Awal page** listed a subledger Temuan as an opening-balance decision: filtered to the opening kind.
- **M — the correcting-journal link** was never wired and broke on a journal explaining two Temuan (unique `resolvedEntryId`):
  dropped; the explanation names the journal.
- **M — tests:** the report-status test now plants a 3290 balance with its own Temuan, so it shows that only that one is named; the
  reader test merges cells for real.
- **M — per-counterparty table:** a name over several aging rows is compared once, with all its rows' references.
- **L — amounts:** "1.000-" and "1.000 CR" read as credits.
- **L — audit:** a Temuan closed by a matching re-import or by deleting the import writes a `FINDING_RESOLVED` event; the delete now
  asks in a dialog that says the Temuan closes as "impor dihapus" and is kept in the history.
- **L — stale Temuan:** the close control computes the difference fresh and says "sekarang cocok, tinggal ditutup"; the card says the
  same above the explanation form.
- **L — UI:** an empty-state sentence when no Rupiah entity is in scope; the picked entity falls back when the scope changes; cards
  ordered open Temuan → explained difference → matching.
- **L — input:** an impossible date (31 Feb) is refused; account codes are trimmed and de-duplicated.

Verification: `tests/unit/aging-read.test.ts` 6 (merged titles, Kode/No columns, summary sheet, formula total, footer, CR and
trailing minus), `tests/db/subledger-recon.test.ts` 4 (adds the payable advance sign, a name over two rows, the date and codes, the
fresh control detail, the audit trail).

## Ship Notes

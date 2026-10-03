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
  - resolving writes the explanation (min. 10 characters), and optionally links a correcting journal the accountant already posted;
    it never posts by itself;
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
- [ ] T2 Comparison and Temuan: `lib/reconcile/subledger.ts` (import, compare, candidates, Temuan open/update/resolve, delete). Accept:
      DB tests with three planted differences (cut-off, advance, non-trade payable), a Rp 5 rounding kept as pass, a re-import that
      doesn't duplicate, and resolve text-only.
- [ ] T3 UI: the *Rekonsiliasi* tab (upload, list by date, comparison card with candidates and per-counterparty table, Temuan resolve),
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

## Verification
- T1: `tests/unit/aging-read.test.ts` → `Tests 3 passed (3)`:
  - an AMS-style xlsx (title rows, headers on rows 6–7, "1-30" as a date, decimal commas, a credit row, a Grand Total row);
  - a semicolon CSV with a text serial;
  - both refusals.

  Lint + typecheck clean; `npm test` → `Test Files 158 passed (158) · Tests 1049 passed (1049)`.

## Ship Notes

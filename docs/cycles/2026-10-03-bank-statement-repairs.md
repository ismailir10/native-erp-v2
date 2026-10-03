# Bank statements that tell the truth (use-case feedback, cycle 5)

## Context
UC-B1 of the owner's use-case document lists bank-statement bugs that once lost real transactions. The pass criteria:
- the rows imported equal the real rows;
- a row repaired automatically is flagged and logged with its original value;
- sub-products in one file are split or confirmed;
- an encrypted PDF asks for its password;
- the running balance is the source of truth: a row that contradicts it is flagged, never trusted blind;
- a wrong header total is reported while the chain is trusted.

A second-model review probed every case through the real parse path (28 synthetic fixtures; CSV, XLSX, PDF incl. encrypted). The pipeline
never repairs on a continuity break: it stores *Ada celah* with one sentence and posts every row as parsed. What fails today:
- **(f) A year typo** (02/08/2023 in a 2026 file) posts silently in 2023. On the first row it makes the import claim 37 months of
  coverage.
- **(e3) A yearless Dec → Jan file** read from January's sheet (a 31/12 row after SALDO AWAL 01/01) rolls *forward*. That row becomes
  31 Dec 2026, the next 02/01 becomes 2 Jan 2027: posted a year late, silently.
- **(c) One row with its direction inverted** (split Debet/Kredit, D/K column, signed amount, BCA PDF DB/CR): the wrong sign is posted.
  The continuity pill shows it, and the month recon fails by twice the amount, with nothing to click.
- **(x1) A dated row with empty amounts but a moved balance** is dropped silently. **(a3) A transaction row with an empty date cell** (a
  ditto row) is dropped silently. Only the next row's continuity break hints at either.
- **(b4) A dated SALDO AWAL row with its amount in Kredit and Saldo** becomes a transaction of that amount and an opening of 0, silently.
  (b3) Its variant fails loudly, but with a message that is not true.
- **Header totals.** A wrong *Saldo Akhir* in the header or trailer is stored as the closing balance while every printed balance chains.
  The note blames the chain, *Kelengkapan* shows a false "tidak nyambung", and a correct earlier file can be refused.
- **(d2/d3) SMBC sub-products** with a title split over two lines, or without a title, are swallowed as one account. The second Saldo
  Awal is ignored and its rows posted to the first account.
- **(g) A BCA PDF** loses the counterparty name after a `TANGGAL :DD/MM` line, and on a page break. Amounts are right; merchant keys,
  rules and memory miss.
- **(e1/e2) Rows of another month on a sheet** are posted right, but nothing says so.

Passing already: (a) blank lines; (b) the common SALDO AWAL shapes; (d1) the shipped SMBC layout; (h) encrypted BNI/Mandiri PDFs with
Indonesian numbers.

Spec approval: the owner approved the plan that put the bank items of UC-B1 after cycle 4, and said "continue with the next cycle". The
cycle runs without a separate stop, like cycles 1–4.

## Spec
- [ ] **One repair step, trusted only when the chain proves it.** `repairStatement` in `lib/import/normalize.ts` is pure. It runs in the
      pipeline right after the section is chosen, before the zero-row filter and the row hashes, so a file imported twice repairs the same
      way and dedupes. A repair is kept only when **every printed balance and the closing then chain**; otherwise everything is left as
      parsed, and the import shows *Ada celah* as today. Each repair adds a note naming the row and the value as written. The note goes to
      the import's notes (`StatementImport.parseNotes`, shown on the Impor page), and the row's `rawRow` keeps the file's cells. Repairs:
      - **(c) Direction:** a row where `previous − amount = printed balance` gets its sign flipped.
      - **(x1) Amount from the balance:** a dated row with no amount whose balance moved gets amount = Δ balance. The tabular parser passes
        such rows through, marked as balance-only; one whose balance didn't move is dropped silently, as today.
      - **(f) Year typo:** a row more than six months from the file's main run of months, in another year, with exactly one date of the
        same day and month inside that run, gets that date. Rows like this are at most 5 and under a fifth of the rows. The chain doesn't
        depend on dates, so this is decided by the dates alone. A far date with no single fix refuses the file, naming the row (a statement
        has no legitimate row a year away). The period is recomputed from the repaired rows when the parser took it from a row.
- [ ] **Header totals (trust the chain).** When every printed balance chains and only the closing header disagrees with the running
      balance, the running balance is the closing balance. A note gives both numbers. A wrong *opening* header can't be decided (a typo,
      or a row missing before the first): the note says both readings and the opening they imply, and the import stays *Ada celah*.
- [ ] **Tabular reader.**
      - **(e3)** A yearless month far *before* the previous one in a file read backwards rolls the year back (Jan → Dec of the year
        before).
      - **(a3)** A row with no date that moves money or the balance takes the previous row's date, with a note. With no previous row it
        refuses, naming the row.
      - **(b4)** A row labelled SALDO AWAL is always the opening. When its only amount equals its balance, or its balance is empty, that
        amount is the opening, with a note.
      - **(b3)** The error says what it saw.
      - **(e1/e2)** Rows dated in another month than their sheet's name are posted by their date, with a note naming the count, the sheet
        and the month.
- [ ] **PDF reader.**
      - **(d2/d3)** A second Saldo Awal row after transactions in one account section refuses the file. The message says it looks like
        more than one account and asks for the accounts to be split. Guessing an unseen title layout could swallow again.
      - **(g)** A line with neither date nor amount no longer ends the row it follows. A `TANGGAL :DD/MM` token is not part of a
        description. After a repeated column header, undated description lines before the first dated row continue the last row of the
        previous page.
- [ ] **Each case has a test** built from the review's fixtures that failed before. `verify:books` still ALL PASS; no existing test
      weakened.

**Non-goals:**
- Splitting SMBC sub-products of an unseen title layout: it needs the real file.
- A per-row flag column (`BankTransaction.parseFlags`, an additive migration): the import notes and `rawRow` already keep the written
  value. Add the column when a screen needs to filter on it.
- Repairing a wrong opening header: it can't be decided.
- Changing `parseRupiah` rounding.
- Making OCR of scanned PDFs.

**Gate-reopeners (flagged):**
- No schema migration, no new dependency, no AI.
- **Accounting invariant:** rule 12 gains one sentence: a row the balance chain contradicts is repaired only when the repair makes the
  whole chain continuous, flagged with its written value; a year a statement can't hold refuses the file.

**Assumptions:**
1. A direction repair needs a printed balance on that row *and* a chain that holds after it. A file without running balances is never
   repaired: nothing proves the repair.
2. A year typo with one fix is repaired without asking. That is unlike the ledger import's acceptable BLOCK: a statement has one bank
   year span, and the import has no draft step to accept on. The note keeps the written date.
3. The page-break continuation (g2) follows the review's synthetic layout; confirm on a real BCA PDF when one comes.

## Tasks
- [x] T1 `repairStatement` (direction, amount from balance, year typo, closing from the chain) + pipeline wiring + the opening-header
      note. Accept: unit tests per repair (incl. a repair the chain refuses), DB test of a repaired import (amount, date, notes, re-import
      dedupes).
- [ ] T2 Tabular reader: backward year roll, dateless rows, SALDO AWAL with an amount, honest b3 message, sheet-month note, balance-only
      rows passed through. Accept: unit tests from the fixtures.
- [ ] T3 PDF reader: second opening refuses, BCA continuation across a `TANGGAL` line and a page break. Accept: PDF fixture tests.
- [ ] T4 Accounting-rules rule 12; end-of-cycle gates, review pass, ship.

## Implementation
- Plan: T1–T4 sequential, inline. The repair step first: T2 feeds it the balance-only rows.
- T1: `lib/import/normalize.ts` `repairStatement`. In order:
  - year typos, with fixes inside the run's months (a typo on the period's first day is before the other rows);
  - the chain walk: direction flips and amounts from balance-only rows, kept only if no printed balance breaks after them;
  - the closing taken from the chain when only the header disagrees.

  `checkContinuity` says both readings of an opening header the first row contradicts. `ParsedRow` gains `balanceOnly` and `written`.

  Pipeline:
  - repairs right after the section is chosen;
  - also dedupes a repaired row by the hash of what the file wrote, with a note telling how to re-import, so a file imported before
    the repair existed never doubles;
  - picks "other sections" against the chosen section (the repair, and before it the zero-row filter, made a new object: the chosen
    section came back as "other" — an existing bug the SMBC test caught).

  The ledger import's year-typo window widens the same way. Tests: `tests/unit/statement-repair.test.ts`,
  `tests/db/statement-repair.test.ts`.

## Verification
- T1: new tests `Tests 8 passed (8)`. The first full run failed `smbc-import` (the identity bug above); after the fix, lint +
  typecheck clean, `npm test` → `Test Files 142 passed (142) · Tests 994 passed (994)`, and `demo:reset && verify:books` →
  `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`

## Ship Notes

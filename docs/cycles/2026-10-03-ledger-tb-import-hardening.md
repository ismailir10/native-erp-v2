# Ledger and TB import hardening (use-case feedback, cycle 4)

## Context
UC-K2 of the owner's use-case document: clients arrive with files, not bank statements. The cases it names are:
- a GL workpaper that starts in February 2023 with no Saldo Awal;
- a trial balance with columns for last year's Dr/Cr, *Adjustment*, the adjusted balance, the movement and the closing balance, under
  headers with typos ("TRIAL BALANCI", "Adjusment");
- a Jan–Jun Neraca without a February column;
- negative AR and LTD balances in a raw workpaper.

*Neraca atau buku besar dari sistem lama* exists but these shapes fail or pass silently today:
- **Header typos.** Headers must match a word list exactly, so a typo hides the column.
- **TB columns.** A TB with column groups reads only its first Dr/Cr pair: the Adjustment and closing columns are dropped without a
  word. Nothing makes the Adjustment visible as its own journal.
- **Negative amounts.** A negative amount in a GL row is moved to the other side silently.
- **File totals.** A GL's own total row is skipped and never compared with its rows.
- **Missing months and year typos.** A month with no rows, and a year typo (2023 in a 2026 file), pass unremarked.
- **Period columns.** A Neraca with several period columns reads the first and ignores the rest silently.
- **Neraca signs.** A negative receivable or a debit payable in a Neraca isn't flagged.
- **Double counting (bug).** A Neraca dated *after* journals already in the entity is posted as Saldo Awal on its own date, so every
  movement before it counts twice. GL rows dated before an existing Saldo Awal double-count the same way.

UC-B4 adds the opening bridge. A GL without Saldo Awal is opened from a later anchor (a Neraca), never a plug.

Who feels it: the accountant onboarding a client from its old files. The first import decides whether they trust the numbers.

Spec approval: the owner approved the plan that named this cycle (*import hardening*, cycle 4) and said "continue with the next cycle".
The cycle runs without a separate stop, like cycles 1–3.

## Spec
- [ ] **Header typos (K2).** Headers are matched after normalising (case, spacing, punctuation). Then a fixed list of known variants is
      tried, then a bounded edit distance: one edit for a word of 5–8 letters, two for longer, never for words under 5. Each column read
      through a typo is reported as an INFO check *Kolom "Adjusment" dibaca sebagai Adjustment*, which is stored with the import.
      Examples: Adjusment → Adjustment, Kredti → Kredit, Debet/Debit, Keteranagn → Keterangan, Saldo Akhri → Saldo Akhir.
      "TRIAL BALANCI" in a title row marks the sheet as a trial balance.
- [ ] **TB with column groups (K2).** A table with account columns and two or more Dr/Cr (or signed balance) column groups is a
      *Neraca saldo* (TB). Groups are labelled on a row above the Dr/Cr headers or in the header itself ("Adjustment Dr"). The groups
      are: saldo awal/akhir tahun lalu, Adjustment/penyesuaian, setelah penyesuaian, mutasi, saldo akhir. It posts as up to three
      journals, all under the import and citing their cells:
      - the opening (OPENING) per the opening date;
      - the Adjustment column as its own **ADJUSTMENT journal on the same date**, visible, never merged into the opening;
      - the movement (IMPORTED) on the closing date. The movement column is used as written; when it is absent, the movement is closing −
        adjusted, and an INFO check says so.

      Every row must tie: opening + adjustment = adjusted, and adjusted + movement = closing. Each row that doesn't is a REVIEW check
      citing it. A *Total* row is compared column by column (TOTAL_OK / TOTAL_MISMATCH). Dates come from:
      - the group headers;
      - the title ("per 30 Juni 2026");
      - the date the accountant fills in.

      When the opening date is not written, it is 31 December of the year before the closing date, and an INFO check says so. A TB with
      a single Dr/Cr pair stays a plain Neraca as today.
- [ ] **Negatives flagged, never made positive (K2).**
      - In a GL row, a negative amount still posts on the other side (the same number), but one REVIEW check per file lists those rows.
      - A Neraca or TB balance against its account's nature (negative receivable, cash or prepaid; debit payable) is REVIEW
        *Saldo berlawanan dengan sifat akun*, posted as written.
- [ ] **File totals (K2).** A GL's grand-total row (Total/Jumlah with debit and credit, no date) is compared with Σ debit and Σ credit of
      the rows: INFO when it ties, REVIEW naming both numbers when it doesn't.
- [ ] **Missing month (K2, B4).**
      - A GL file with no rows in a month between its first and last is REVIEW *Tidak ada baris di Februari 2026*, per entity.
      - So is a gap between this file and the entity's earlier posted GL imports.
      - A Neraca with several period columns (dates, or month headers like "Jan 2026") reads the first, as today, as Saldo Awal. A
        REVIEW names the other columns, which are not imported, and any month missing between them (*Kolom Februari 2026 tidak ada*).
- [ ] **Year typo (B1f, K2).** A GL row dated more than six months from the file's main run of months is flagged, when such rows are at
      most 5 and under a fifth of the file. When exactly one date with the same day and month falls inside the file's period, it is BLOCK
      *tanggal 5 Mar 2023 jauh dari periode file*, and the accountant may **accept** that date. The journal then posts on the corrected
      date, and its memo keeps the date as written. Otherwise it is REVIEW and posts as written; it may be a real old adjustment.
- [ ] **No double counting around Saldo Awal (bug).**
      - GL rows dated on or before the entity's Saldo Awal are BLOCK *sudah termasuk di saldo awal*. The way out is named: import from
        the next day, or remove the Saldo Awal import and import that Neraca again as the anchor.
      - A Neraca dated after the entity's first journal is not a Saldo Awal on its own date: it becomes an **anchor** (next item).
- [ ] **Opening bridge (K2, B4).** An entity with journals and no Saldo Awal, given a Neraca dated after its first journal, gets Saldo
      Awal (OPENING) dated the day before that first journal. When posted, the entry holds:
      - every anchor line (mapped, citing its cell);
      - per account, the movement the books already hold up to the anchor date, reversed (memo *mutasi buku s.d. 31 Des 2023*);
      - on 3200, the result of the income and expense accounts up to that date.

      Then the Neraca at the anchor date equals the file, to the rupiah. Income or expense accounts mapped from the anchor are refused (a
      Neraca has none). An unbalanced anchor is the existing acceptable BLOCK (1999).

      The draft says it is a bridge and what that means: the books before the first journal are not known, and its result sits in
      Saldo Laba. A GL import into an entity without Saldo Awal says so (INFO: a GL file often carries its own opening rows, which is
      why the close asks for Saldo Awal only when no GL was imported) and names both ways in.
- [ ] **Synthetic K2 set (K5 style).** A test builds four files with known final numbers:
      - a GL in journal format with no Saldo Awal;
      - a Neraca anchor after it;
      - a TB with typo headers and an Adjustment column;
      - a Jan–Jun Neraca without February.

      The test imports them through the real pipeline and checks the TB, Neraca and Laba Rugi to the rupiah, plus every trap above.

**Non-goals:**
- PDF financial statements: per the plan, they come after GL/TB import ties out; until then a PDF is the tie-out reference, not a
  second source.
- Importing a Neraca's later period columns as monthly movements.
- Per-client FS template (cycle 5) and non-calendar fiscal year (cycle 6): the TB opening date assumes a calendar year until then.
- Bank-statement items of UC-B1 (direction flags against the running balance, BCA name lost after "TANGGAL :", a blank line mid-file,
  sub-products in one file): a short bank cycle after this one.
- Moving the Neraca source difference (1999) to Temuan.

**Gate-reopeners (flagged):**
- No schema migration: a TB is stored as a Neraca-mode import (it carries the Saldo Awal), its kind per entry in the saved plan.
- No new dependency. No AI.
- **Accounting invariant:** rule 15a gains the TB entries (OPENING + ADJUSTMENT + IMPORTED) and the bridge. Rule 5's one-opening-per-entity
  stands: the bridge *is* that opening. Recorded in accounting-rules; no new ADR, because no earlier decision is reversed.

**Assumptions:**
1. A typo is accepted only against the column words Buku already knows; a header that is not near any of them stays unread, as today.
2. The bridge's income and expense before the first journal fold into 3200: Laba Rugi for that year starts at the first journal. The
   draft and the entry memo say so.
3. A year-typo fix is offered only for a single day/month that falls inside the file's own period; any other far date is REVIEW and
   posts as written.
4. TB dates without a written opening date assume the calendar year (cycle 6 generalises).
5. Of several period columns the first is read, as today. Picking the earliest instead would change a comparative Neraca (current year
   first) that already imports correctly.

## Tasks
- [x] T1 Header typos: normaliser + variants + bounded edit distance in `lib/ledger-import/read.ts`, header notes → INFO checks stored
      with the import. Accept: unit tests for each listed typo and for words that must not match.
- [x] T2 GL checks: negatives listed, grand-total tie-out, missing month (in file and against earlier imports), year typo with an
      acceptable fix, rows on/before Saldo Awal refused, GL without Saldo Awal flagged (`check.ts`, `post.ts`, accept button). Accept:
      unit + DB tests per check.
- [x] T3 Neraca: sign against nature; several period columns → the first read, the rest and missing months named. Accept: unit tests.
- [ ] T4 TB with column groups: detection, reading, plan of three journals with per-row ties and total tie-out, per-entry kind on
      posting, "Neraca saldo (TB)" label. Accept: DB test posts a TB and the TB report equals its closing column; the ADJUSTMENT entry
      stands alone.
- [ ] T5 Opening bridge: a Neraca after the first journal stages as an anchor; post computes the bridge; refusals. Accept: DB test,
      Neraca at the anchor date equals the file; no double counting.
- [ ] T6 Synthetic K2 set end-to-end + accounting-rules 15a. Accept: the four-file test passes to the rupiah.
- [ ] T7 End-of-cycle gates, review pass, ship.

## Implementation
- Plan: T1–T7 sequential, inline (each builds on the reader and the plan of the one before).
- T1: `lib/ledger-import/read.ts` `normalizeHeader`, `editDistance` (optimal string alignment, capped), `nearestWord` (ties between
  columns refused), `FUZZY_WORDS` as the fallback after the exact header patterns; `TableCandidate.typos` with the column; `post.ts`
  stores one INFO `HEADER_TYPO` per typo, citing the header cell. Test: `tests/unit/ledger-header-typos.test.ts`.
- T2: the reader keeps a GL's Total rows (`LedgerTotal`) and marks a flipped negative row (`negative`, `raw`); `planLedger` adds
  `NEGATIVE_AMOUNT` (REVIEW, one per file), `TOTAL_OK` / `TOTAL_MISMATCH` against the last Total row, which must be the largest, summed
  as written, and `MISSING_MONTH` in the file. It also adds `dateOutliers`: a run of months more than six months from the main run, at
  most 5 rows and under a fifth of the file. With one fix that is `DATE_TYPO` (BLOCK, acceptable, the plan already posts on the fixed
  date, memo keeps the written one); without one it is `DATE_OUTLIER` (REVIEW). `post.ts` `ledgerBookChecks` adds:
  - `BEFORE_OPENING` (BLOCK, not acceptable);
  - `NO_OPENING` (INFO, not REVIEW: the close already treats a GL import as carrying its own opening rows);
  - `MISSING_MONTH` between this file and the entity's posted GL.

  The import's period follows the dates that will post. `ACCEPTABLE_CHECKS` (UNBALANCED, DATE_TYPO) drives `acceptCheck`, the draft page
  and the accept button's wording. Tests: `tests/unit/ledger-checks-k2.test.ts`, `tests/db/ledger-import-k2.test.ts`.
- T3: `check.ts` `signChecks` (shared with the TB in T4) in `planNeraca`; `read.ts` `periodHeader` (dates and month headers →
  month end), `periodColumns` on the candidate (`periods`); a month header can now be the amount column and the Neraca date. Also
  `MULTI_PERIOD` (REVIEW): the column read, the others not imported, the missing months. Test: `tests/unit/neraca-k2.test.ts`.

## Verification
- T1: `npx vitest run tests/unit/ledger-header-typos.test.ts tests/unit/ledger-read.test.ts` → `Tests 16 passed (16)`; lint + typecheck
  clean; `npm test` → `Test Files 130 passed (130) · Tests 944 passed (944)`.
- T2: new tests `Tests 9 passed (9)`. The first full run failed one existing test (`ledger-controls`: NO_OPENING as REVIEW added a
  "temuan" to the import's close control), which led to the INFO decision; that file and the new ones then passed
  (`Tests 10 passed (10)`), and the full run had no other failure (`952 passed`). Lint + typecheck clean.
- T3: `tests/unit/neraca-k2.test.ts` + reader / Neraca tests → `Tests 22 passed (22)`; lint + typecheck clean; `npm test` →
  `Test Files 133 passed (133) · Tests 956 passed (956)`.

## Ship Notes

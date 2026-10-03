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
- [x] **Header typos (K2).** Headers are matched after normalising (case, spacing, punctuation). Then a fixed list of known variants is
      tried, then a bounded edit distance: one edit for a word of 5–8 letters, two for longer, never for words under 5. Each column read
      through a typo is reported as an INFO check *Kolom "Adjusment" dibaca sebagai Adjustment*, which is stored with the import.
      Examples: Adjusment → Adjustment, Kredti → Kredit, Debet/Debit, Keteranagn → Keterangan, Saldo Akhri → Saldo Akhir.
      "TRIAL BALANCI" in a title row marks the sheet as a trial balance.
- [x] **TB with column groups (K2).** A table with account columns and two or more Dr/Cr (or signed balance) column groups is a
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
- [x] **Negatives flagged, never made positive (K2).**
      - In a GL row, a negative amount still posts on the other side (the same number), but one REVIEW check per file lists those rows.
      - A Neraca or TB balance against its account's nature (negative receivable, cash or prepaid; debit payable) is REVIEW
        *Saldo berlawanan dengan sifat akun*, posted as written.
- [x] **File totals (K2).** A GL's grand-total row (Total/Jumlah with debit and credit, no date) is compared with Σ debit and Σ credit of
      the rows: INFO when it ties, REVIEW naming both numbers when it doesn't.
- [x] **Missing month (K2, B4).**
      - A GL file with no rows in a month between its first and last is REVIEW *Tidak ada baris di Februari 2026*, per entity.
      - So is a gap between this file and the entity's earlier posted GL imports.
      - A Neraca with several period columns (dates, or month headers like "Jan 2026") reads the first, as today, as Saldo Awal. A
        REVIEW names the other columns, which are not imported, and any month missing between them (*Kolom Februari 2026 tidak ada*).
- [x] **Year typo (B1f, K2).** A GL row dated more than six months from the file's main run of months is flagged, when such rows are at
      most 5 and under a fifth of the file. When exactly one date with the same day and month falls inside the file's period, it is BLOCK
      *tanggal 5 Mar 2023 jauh dari periode file*, and the accountant may **accept** that date. The journal then posts on the corrected
      date, and its memo keeps the date as written. Otherwise it is REVIEW and posts as written; it may be a real old adjustment.
- [x] **No double counting around Saldo Awal (bug).**
      - GL rows dated on or before the entity's Saldo Awal are BLOCK *sudah termasuk di saldo awal*. The way out is named: import from
        the next day, or remove the Saldo Awal import and import that Neraca again as the anchor.
      - A Neraca dated after the entity's first journal is not a Saldo Awal on its own date: it becomes an **anchor** (next item).
- [x] **Opening bridge (K2, B4).** An entity with journals and no Saldo Awal, given a Neraca dated after its first journal, gets Saldo
      Awal (OPENING) dated the day before that first journal. When posted, the entry holds:
      - every anchor line (mapped, citing its cell);
      - per account, the movement the books already hold up to the anchor date, reversed (memo *mutasi buku s.d. 31 Des 2023*);
      - on 3200, the result of the income and expense accounts up to that date.

      Then the Neraca at the anchor date equals the file, to the rupiah. Income or expense accounts mapped from the anchor are refused (a
      Neraca has none). An unbalanced anchor is the existing acceptable BLOCK (1999).

      The draft says it is a bridge and what that means: the books before the first journal are not known, and its result sits in
      Saldo Laba. A GL import into an entity without Saldo Awal says so (INFO: a GL file often carries its own opening rows, which is
      why the close asks for Saldo Awal only when no GL was imported) and names both ways in.
- [x] **Synthetic K2 set (K5 style).** A test builds four files with known final numbers:
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
- [x] T4 TB with column groups: detection, reading, plan of three journals with per-row ties and total tie-out, per-entry kind on
      posting, "Neraca saldo (TB)" label. Accept: DB test posts a TB and the TB report equals its closing column; the ADJUSTMENT entry
      stands alone.
- [x] T5 Opening bridge: a Neraca after the first journal stages as an anchor; post computes the bridge; refusals. Accept: DB test,
      Neraca at the anchor date equals the file; no double counting.
- [x] T6 Synthetic K2 set end-to-end + accounting-rules 15a. Accept: the four-file test passes to the rupiah.
- [x] T7 End-of-cycle gates, review pass, ship.

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
- T4: `read.ts` `tbLayout` is tried first at every header row:
  - two rows (labels carried right until the next, then Dr/Cr) or one row ("Saldo Awal Debit");
  - groups found by phrase (longest first), else by `nearestWord` (a typo, reported);
  - "Saldo <date>" pairs become the opening and the closing by date.

  `readTb` gives:
  - per-group signed values;
  - the Total rows;
  - the dates: group header, else title, where a period starting on the 1st means the day before;
  - Neraca rows of the closing balance, so evidence and previews keep working.

  In `check.ts`, `planTb` builds OPENING / ADJUSTMENT / IMPORTED entries (`PlanEntry.kind`), each line citing its column's cell, and adds
  `TB_ROW_MISMATCH`, `TOTAL_OK` / `TOTAL_MISMATCH` per column, `TB_DERIVED` and the sign checks. `post.ts` handles the TB branch (opening
  date assumed = previous year end, INFO `TB_OPENING_DATE`; `tb: true` in the saved plan) and posts each entry with its own kind.
  `code.ts` `importKindLabel` gives "Neraca saldo (TB)" on the Impor list and the draft page. Typos now carry their label and row.
  Test: `tests/db/ledger-import-tb.test.ts`.
- T5: in `post.ts` staging:
  - a non-TB Neraca dated on or after the entity's first journal stages as an anchor: its entry moves to the day before that journal and
    carries `bridge.anchor`, with REVIEW `OPENING_BRIDGE`;
  - a TB over months with journals is BLOCK `TB_OVERLAP`.

  When posting, `bridgeLines` recomputes from the books as they stand:
  - it reverses each balance-sheet account's movement up to the anchor and puts that span's income and expense on 3200;
  - it refuses money on 1999/1199 at the anchor and an anchor line mapped to income or expense;
  - with no journals up to the anchor, it is a plain Saldo Awal on the anchor date.

  Test: `tests/db/ledger-import-bridge.test.ts` (Neraca at the anchor equals the file; TB, BS and Laba Rugi to the rupiah).
- T6: `tests/db/k2-files.test.ts` runs the four files of UC-K2, known numbers in its header, through stage → map → post, and asserts:
  - every trap on the draft: typos, negative row, Total tie, missing months, no Saldo Awal, bridge, TB typos and tie, Neraca without
    February;
  - the reports to the rupiah.

  Found on the way: a GL Total row with its label in the date column read as an unreadable date (BLOCK). A total row is now "no
  readable date" wherever its label sits. Accounting-rules rule 15a gains the paragraphs on files from old systems, the TB and the
  opening bridge.

- T7 review pass (second-model review, probes against the branch and `main`). Fixed, each with a test in
  `tests/db/ledger-import-review.test.ts`:
  - **H1** A textbook worksheet (*Sebelum Penyesuaian | Jurnal Penyesuaian | Setelah Penyesuaian*) was read as Adjustment + adjusted
    and posted the whole unadjusted TB as an Adjustment a year early. Now:
    - a group UNADJUSTED ("sebelum penyesuaian", "unadjusted", "before adjustment") exists;
    - a layout without saldo awal, mutasi and saldo akhir is a one-date worksheet: OPENING + ADJUSTMENT on its own date
      (`tbIsWorksheet`);
    - saldo awal together with sebelum penyesuaian is BLOCK `TB_LAYOUT`.
  - **H2** A GL (or bank statement) imported after a TB double-counted the TB's period. GL rows in (Saldo Awal, TB closing] are BLOCK
    `TB_COVERS`; the bank pipeline refuses such rows the same way it refuses rows before Saldo Awal.
  - **M1/L4** "Saldo Awal | Debit | Kredit | Saldo Akhir" under Aset/Liabilitas/Ekuitas headings regressed to two unbalanced BLOCKs.
    Now:
    - a plain one-word Debit/Kredit pair beside named groups is the movement;
    - a one-column group that balances only with liabilities and equity turned around is read debit-positive (INFO
      `TB_PRESENTATION_SIGN`), and its section Total is not compared;
    - section headings type the rows.
  - **M2** A print date ("Dicetak: 15/07/2026") became the closing date. Title rows that name a period win, print/export rows never
    count, and an opening date comes only from the closing's own row.
  - **M3** A TB from Dokumen could never stage (its derived opening fell outside the confirmed date). A TB is checked against the window
    of its closing date.
  - **M4** Saldo awal + setelah penyesuaian without an Adjustment column posted balances unequal to the file's closing. The implied
    adjustment is derived and posted as its own ADJUSTMENT (INFO).
  - **M5** A Neraca anchor with sen (a 7190 rounding line) was refused as "mapped to income". Only the file's own lines are checked.
  - **M6** A TB's ADJUSTMENT journal could be reversed from the ledger page, and could suppress a 1999 correction proposal.
    `reversalBlocker` refuses entries with `ledgerImportId`; `priorCorrection` ignores them.
  - **L1** A closed month is BLOCK `PERIOD_LOCKED` on the draft, not only at posting.
  - **L2** Removing a GL or statement whose journals a bridge took into Saldo Awal is refused (`refuseBridgeDependents`).
  - **L3** Missing months between period columns are claimed only for a monthly series.
  - **L5** A far month of the same year is not a year typo.
  - **L6** Typos in a TB's account headers are reported.

  The first full run after the fixes failed `evidence-workbook` (2 tests): the bare-pair rule read "Mvt Dr / Mvt Cr" in a derived engine
  sheet as movement. It now takes only a plain side word.

  Kept: L7 (a dateless, accountless row saying Total is a total).

## Verification
- T1: `npx vitest run tests/unit/ledger-header-typos.test.ts tests/unit/ledger-read.test.ts` → `Tests 16 passed (16)`; lint + typecheck
  clean; `npm test` → `Test Files 130 passed (130) · Tests 944 passed (944)`.
- T2: new tests `Tests 9 passed (9)`. The first full run failed one existing test (`ledger-controls`: NO_OPENING as REVIEW added a
  "temuan" to the import's close control), which led to the INFO decision; that file and the new ones then passed
  (`Tests 10 passed (10)`), and the full run had no other failure (`952 passed`). Lint + typecheck clean.
- T3: `tests/unit/neraca-k2.test.ts` + reader / Neraca tests → `Tests 22 passed (22)`; lint + typecheck clean; `npm test` →
  `Test Files 133 passed (133) · Tests 956 passed (956)`.
- T4: `tests/db/ledger-import-tb.test.ts` + reader tests → `Tests 26 passed (26)`; lint + typecheck clean; `npm test` →
  `Test Files 134 passed (134) · Tests 960 passed (960)`.
- T5: `tests/db/ledger-import-bridge.test.ts` → `Tests 3 passed (3)`; lint + typecheck clean; `npm test` →
  `Test Files 135 passed (135) · Tests 963 passed (963)`; `demo:reset && verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok
  dengan ground truth.`
- T6: `tests/db/k2-files.test.ts` → `Tests 1 passed (1)` (failed first on the Total row above); lint + typecheck clean; `npm test` →
  `Test Files 136 passed (136) · Tests 964 passed (964)`.

- T7: `tests/db/ledger-import-review.test.ts` → `Tests 11 passed (11)`. End of cycle:
  - lint + typecheck clean;
  - `npm test` → `Test Files 140 passed (140) · Tests 986 passed (986)`;
  - `npm run build` ok;
  - `demo:reset && verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`;
  - e2e runs in CI.

  Visual check (local, Chromium): a staged TB with typos shows "Impor neraca saldo (TB): TB", 31 Des 2025 – 30 Jun 2026, the typo cited at
  TB!E3, "Catat 3 jurnal", and "Neraca saldo (TB)" on the Impor list. No overflow at 390 px, no console errors.

## Ship Notes
- **Migration:** none. A TB is a Neraca-mode import (`data.tb`), each entry with its kind in the saved plan.
- **Behaviour:**
  - GL, Neraca and TB drafts gain checks: header typos, negatives, Total tie, missing months, year typos (acceptable fix), closed months,
    Saldo Awal and TB overlaps, sign against nature, extra period columns.
  - A TB posts opening + Adjustment + movement; a one-date worksheet posts its balances and adjustments on its date.
  - A Neraca after the first journal becomes an opening bridge.
  - The bank import refuses rows inside a TB's period.
  - A TB's Adjustment can't be reversed by hand.
- **Rollback:** revert the merge. Journals posted from a TB or a bridge stay valid entries (OPENING / ADJUSTMENT / IMPORTED under their
  import) and can be removed with *Hapus impor*.


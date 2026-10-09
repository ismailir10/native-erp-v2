# Many statements in one go: drop the folder, Buku sorts and imports

## Context
Month-end is never one file. A client with 3 bank accounts sends 3 PDFs a month; onboarding a client with a year of history is 12 × N files.
Today the import page takes **one file and one account at a time**: pick the account, pick the file, *Proses mutasi*, read the result,
repeat — and the order matters, because a statement from before the account's first one must hand over to it (a December file imported
first, then November, is fine; a wrong guess of which account a file belongs to costs a refusal and a retry). The previous cycle left
"batch upload of several files at once" as the explicit next step (`2026-10-09-column-mapping.md`, Non-goals).

Who feels it: the accountant on the first day of a month-end close or of a client migration. The investor question after "which banks?"
is "how long does a year of statements take?" — the honest answer today is *a lot of clicks*.

Intended outcome: choose or drop many files; Buku **reads each one without importing**, recognises the bank account from the account number
in the file, shows one table (file → account → period → status) sorted oldest first, and imports them one after another with progress.
What needs a human (password, year, a scan, an unknown layout, an account Buku can't tell) is named per file, never silently skipped,
and never blocks the files that are fine.

Approval: the owner's brief in-session ("continue improving Buku until we are proud with our work") is the go-ahead, same pattern as the
earlier owner-briefed cycles. Re-open if the work needs a migration or a dependency.

## Spec
- [ ] **B1 Many files** — the file input and the drop area on the import page accept several files. One file behaves exactly as today
  (same form, same result card). Two or more files open the batch table below the drop area; the single-file form is hidden until the
  batch is cleared. A file over 5 MB or of an unsupported type is listed with its reason and left out of the run (the rest go on).
- [ ] **B2 Read first, write nothing** — each file is read on the server by a new `peekStatementAction` (one call per file, so each stays
  under the upload limit): file name, bank named in the file, the account number(s) and period(s) it holds, row count, and whether it
  needs something from the accountant. Nothing is stored, no AI is called, no journal is touched.
- [ ] **B3 Account recognised** — each section is matched to the client's bank accounts by account number (digits only, as the pipeline
  does). A combined file (SMBC, Jago pockets) yields one line per matched account; a section with no account of this client is listed
  "tidak ada rekeningnya di klien" and not imported. A file without a number (some CSV/Excel) goes to the account chosen in the form
  above the table when the client has more than one, or to the only account when there is one; the row has its own account picker
  to change the guess before importing. Foreign-currency sections are listed as not importable (as today).
- [ ] **B4 Oldest first** — the table is sorted by account, then period start; importing runs in that order so each statement hands
  over to the one before. A file that cannot be read yet (password / year / scan / unreadable) sits at the bottom with its action:
  *Kata sandi* and *Tahun* fields inline (answered, the row is read again), *Baca scan dengan AI* or *Atur kolom* → opens the
  single-file flow for that file with the file already loaded.
- [ ] **B5 Import with progress** — *Impor N file* runs `importAction` per line in table order ("Mengimpor 3 dari 7 · BCA Giro Mar 2026"),
  stops nothing on a failed line: that line shows the pipeline's own message (locked period, Saldo Awal guard, handover break) and the
  run continues with the other accounts. A later line of the **same account** after a failed one is still attempted (the continuity
  check reports a gap honestly, *Kelengkapan data* shows it). A closed tab stops between files; every file is complete or untouched.
- [ ] **B6 One result** — when done: totals (files imported / already on file / failed, transactions processed, lines waiting in
  Periksa), one row per line with the same facts as the single result (rows, duplicates, needs review, *Saldo nyambung* or the gap),
  and the one next step the single result already offers (*Periksa transaksi*), plus *Kelengkapan data* link. Re-dropping the same folder
  is safe: the pipeline dedupes ("sudah ada", nothing doubled).
- [ ] **B7 Safe by construction** — every step is tenant-scoped through `getClientForFirm`; the account a line goes to must belong to the
  client (re-checked by `importAction`, which is unchanged); the browser sends the file again at import, never parsed rows. Accounting
  invariants untouched: rows still enter through `importStatement` → `postBankTransaction`, AI suggestions still go to review.
- [ ] **B8 Production check** — after merge, on a throwaway client *Uji Banyak File (hapus)*: 3 synthetic monthly statements of one
  account dropped in scrambled order + a duplicate + a file of a second account; imported oldest first with *Saldo nyambung*; the client
  is deleted. No real client is touched.
- [ ] **Deck (ship step 3)** — `public/deck/kantor.html` import slide (05): review "tunjuk kolomnya sekali"/bank claims and add
  "unggah satu folder sekaligus" only if B1–B6 shipped.

**Non-goals:** zip/folder archives (browser multi-select only); more than 24 files per run (listed, asked to do the rest after); parallel
imports (strictly one at a time — order and the account lock); importing the *Kiriman klien* collection in bulk (next); changing any
reader, `importStatement`, dedupe, continuity or the classifier; batch for ledger/Neraca files or scans (scans stay one at a time with
AI); a "plan" saved between visits.

**Gate-reopeners flagged:** none expected — no schema migration, no new dependency, no AI credit beyond what the same imports would use
one by one (an import with a configured model still makes its own bounded, cached call; a 12-file run is 12 imports), no change to an
accounting invariant.

**Assumptions:**
1. The client sends each file again at import (two uploads per file: read, then import). Files are ≤ 5 MB and the server action body
   limit is per call, so a batch of any size never exceeds it; the alternative (keep parsed rows on the server between steps) would
   add state and a way to import what the accountant never saw.
2. Order is by period start per account; across accounts the order is by account label, which doesn't matter for correctness
   (transfer matching looks at open counterparts of the whole client, so a later import still pairs with an earlier one).
3. A file that mismatches the account the picker guessed is never auto-redirected beyond the number match: no number → the row asks.
4. 24 files per run keeps the table readable at 390 px and a run to a few minutes; the cap is a UI constant, not a server rule.
5. Passwords are used once per file for the read and the import and held only in this page's memory (as the single-file form does).

## Tasks
- [ ] T1 `lib/import/peek.ts`: `peekStatement` (parse sections without writing; match to the client's accounts; status per line) and
  `planBatch` (pure: order by account then period, unreadable last) — accept: unit tests for `planBatch`; db test: account matched by
  number, combined PDF → one line per account + one unmatched, foreign section flagged, no-number file → needs account, password →
  *needs password*, nothing written.
- [ ] T2 `peekStatementAction` in `app/actions.ts` (tenant scoped, size/type checks, password/year passed through) — accept: db or
  action test for a foreign client's id refused; covered end to end in T3.
- [ ] T3 `components/app/batch-import.tsx` + wiring in `import-form.tsx` (`multiple`, drop of many, table, inline password/year,
  progress, result) — accept: e2e `statement-batch.spec.ts` (three months of one account in scrambled order + a second account's file
  + a duplicate → imported oldest first, *Saldo nyambung*, rerun = "sudah ada"; an unreadable file doesn't block the others; 390 px
  without page scroll); screenshots looked at, desktop and 390 px.
- [ ] T4 End-of-cycle gates, README Import row + `docs/real-data.md` mention, Ship Notes, production check (B8), deck review.

## Implementation
## Verification
## Ship Notes

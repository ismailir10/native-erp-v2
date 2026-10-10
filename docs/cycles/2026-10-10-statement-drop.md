# Drop a bank statement, Buku does the rest

## Context
Live production test on 2026-10-10 with two real BCA e-statement PDFs (giro, June and August 2026) on a client
that has no rekening registered yet:

- **Impor Mutasi** showed only "Impor Buku Besar". No bank statement upload existed anywhere on the page. The
  bank upload only appears after a rekening is added in Pengaturan, and nothing says so. The menu item still reads
  "Impor Mutasi", so the user lands on a page that contradicts its own name.
- **Dokumen** read the PDFs and called them "Rekening koran", then asked for six fields by hand (Peran,
  Entitas, Mata uang, Dari, Sampai, Rekening). Every one of them is printed on the statement. The Rekening list
  was empty for the same reason as above. One AI-proposed fact was wrong ("Mata uang: INDONESIA"). The holder
  printed on the file (BELIFI MAHAJAYA NUSANTARA PT) differed from the client's company, with no warning.
- Buku's own bank reader parsed both files perfectly (rekening 7655563814, IDR, full month, 31 and 210 rows,
  printed opening and closing). The engine works; the flow in front of it asks the user to think.

A second round the same day ran Buku's reader on real statements from six banks (one client's folders, kept in
gitignored `data/private/`):

| Bank / file | Result today |
|---|---|
| BCA giro (PT), BCA giro + tahapan (pribadi), PDF | Read fully: rekening, period, printed opening/closing |
| SMBC Touchbiz, one PDF with three accounts | Read fully, all three accounts |
| Mandiri e-Statement, password PDF | Read with the password, but the bank shows as unknown ("Tabungan Mandiri" / "Menara Mandiri" isn't recognised) |
| BNI wondr "Laporan Mutasi Rekening", password PDF | Read with the password, but bank unknown and **no rekening number** (printed as "TAPLUS BISNIS - 8311101816", no "BNI" in the header) |
| BRI BRImo "Laporan Transaksi Finansial", PDF | **Refused**: the empty side prints `0.00` and is read as an amount ("Debet dan Kredit sama-sama berisi nominal") |

A third round walked the same files through production (client Skypuats Industries: rekening added by hand in
Pengaturan — 1 PT + 6 pribadi under a new pemilik — then each file uploaded on Impor Mutasi):

| File | What the user saw |
|---|---|
| BCA PT Jun / Aug | Imported (31 / 210 rows). ~20–40 s behind a bare spinner. July gap flagged correctly (−Rp 4.276.500), but the result card says "Nyambung" while the table above says "Tidak nyambung". |
| BCA pribadi Jan, uploaded with the default (wrong) rekening selected | Blocked: "Nomor rekening di file berbeda…" + *Pakai rekening …* although Buku knew the right one. After the click it imported (242 rows) **but the page never showed a result**; only a reload revealed it. |
| BCA tahapan Jan | Imported (188 rows) after ~2 min; AI answer cut off ("terpotong, batas 12000 token") so 167 rows got simple guesses. |
| BRI Jan | Refused (`0.00` side). The error is a toast that vanishes in seconds; the previous file's result stays on screen as if it were this file's. |
| BNI Jan (password) | Imported (75 rows); "Bank di file: Tidak disebut di file"; no number in the file, so it would import into whichever rekening is selected. |
| Mandiri Jan (password) | Asked the same password again; imported (93 rows) after ~90 s; bank "Tidak disebut di file". |
| SMBC May (3 accounts) | Imported the selected one (12 rows); the other two listed as "tidak diimpor ke rekening ini" with no way to add them here. |

Also: adding 7 rekening by hand took ~30 clicks/fields copied off the statements; the rekening select resets to the
first rekening on every load; several page loads and two import POSTs returned 503 during the walk.

BNI and Mandiri are locked with the same password; today it is asked once per file. Folder 2 (Jurnal exports:
cash flow, neraca, laba rugi) and folder 3 (Filosofi Kopi P&L reports) are not bank statements and stay out of
this cycle.

Who feels it: the accountant on day one with a new client, which is exactly when trust is won or lost. Principle:
the user drops files; Buku reads what is printed on them and asks only what it truly cannot know.

## Decisions
1. **File first.** On Impor Mutasi the bank statement upload is always there, even with zero rekening. Buku picks
   the rekening from the account number printed in the file; the user no longer picks one before uploading.
2. **New rekening → one-click confirm card**, not silent creation: "Rekening baru: BCA ·3814 a.n. <holder> →
   milik [entitas ▾]" with *Tambah & impor*. The entity is preselected (the only entity, or the one whose name
   matches the holder). Reason: adding a rekening changes the client's structure; it stays visible but costs one click.
3. **Holder ≠ any entity name → warn, allow.** A yellow note asks "Klien yang benar?" with *Tetap impor*.
   Reason: names legitimately differ (PT prefix, abbreviations); blocking would add friction for the common case.
4. **Several files at once**, imported oldest period first, one result line per file. A file's own problem stops
   only that file.
5. **Dokumen detects and hands over.** For a bank statement, Dokumen runs the same deterministic bank reader,
   fills entity/period/currency/rekening itself, and offers one button *Bukukan* (no re-upload, no six-field form).
   It goes through the same confirm card when the rekening is new. Impor Mutasi stays the one booking path
   (the existing deterministic pipeline is the only writer).
6. **Every real statement from the test folders reads.** BRImo zero sides are "empty", Mandiri and BNI wondr
   headers name their bank, BNI wondr's "PRODUCT - number" line gives the rekening. All deterministic: the header
   and table as printed, never transaction text, never AI.
7. **Password asked once per drop.** One prompt for every locked file in the drop; the password is tried on each
   and never stored (unchanged rule).

## Acceptance criteria
- [ ] Each real statement in the test set reads with the right bank, rekening number, period and printed opening/
      closing: BCA ×3 accounts, SMBC ×3 accounts in one file, Mandiri, BNI wondr, BRI BRImo. BRImo files no
      longer refuse; a row with amounts on both sides still refuses.
- [ ] Dropping several locked files asks for the password once; files it doesn't open ask again for themselves.
- [ ] Every file in a drop ends in a visible line — imported (rows, rekening, period) or its own error — that stays
      until the next drop. No toast-only errors, no stale result from an earlier file, no import that only shows
      after a reload; a slow import shows which file it is on.
- [ ] A file whose rekening Buku cannot read (no number printed) is never silently booked into the selected
      rekening: the user picks it once in the card.
- [ ] The other accounts in a combined file (SMBC) appear in the same confirm card and import in the same drop.
- [ ] Result wording agrees with Kelengkapan data: a file that is internally continuous but doesn't join the
      previous month says so on its result line.
- [ ] A client with no rekening: Impor Mutasi shows the bank statement upload as the primary action; the ledger
      import remains reachable as the second choice. Page title and menu agree.
- [ ] Dropping a statement whose rekening is new shows a confirm card with bank, last four digits, holder, period
      and the preselected entity; one click adds the rekening and imports it. No visit to Pengaturan.
- [ ] Dropping a statement whose rekening is registered imports straight into that rekening, whatever was selected
      before. No account-mismatch error for a file whose number Buku already knows.
- [ ] Dropping two or more files imports them oldest period first; the result lists each file with its rekening,
      period, rows and continuity, or its own error.
- [ ] A holder name that matches no entity of the client shows the warning and still allows the import.
- [ ] In Dokumen, a bank statement shows rekening, period and currency read from the file (no "Belum dipilih",
      no empty dates) and one *Bukukan* action that books it through the bank import, with the confirm card
      when the rekening is new.
- [ ] Dokumen no longer confirms a country name as a currency.
- [ ] Saldo Awal still prefills from the first imported statement (unchanged behavior, checked end to end).
- [ ] `verify:books` ALL PASS; the investor demo walk still passes.
- [ ] Deck claims to review: any slide saying "upload a bank statement and Buku reads it" (ship.md § Deck review).

## Verify flows
1. **New client, first statement** (Admin): create a client with one entity and no rekening → Impor Mutasi →
   drop a synthetic BCA PDF → confirm card shows BCA ·xxxx, holder, period, entity preselected → *Tambah & impor*
   → result shows rows, Nyambung → Saldo Awal prefilled from the statement.
2. **Three months at once** (Akuntan): drop June, July and August in random order → imported June, July, August;
   continuity Nyambung across months; one result line per file.
3. **Edge — wrong client**: drop a statement whose holder is another company → yellow "Klien yang benar?" note →
   *Tetap impor* works; cancelling imports nothing.
4. **Error — unreadable file**: drop a photo or a password-protected PDF among good files → that file shows its
   own message (scan / password prompt), the others import.
5. **Dokumen**: upload the same BCA PDF in Dokumen → fields already filled → *Bukukan* → lands imported in the
   same rekening as flow 1.

## UX notes
- Impor Mutasi, no rekening yet: one drop zone, "Tarik rekening koran ke sini — PDF, Excel, CSV, MT940. Bisa
  beberapa file sekaligus." Below it, a quiet link "Impor buku besar atau neraca dari sistem lama".
- The rekening select disappears from the upload step; the rekening shows in each result line instead.
- Confirm card primary action: *Tambah rekening & impor*. Secondary: *Batal*. Entity select only when the client
  has more than one entity.
- Dokumen bank statement: one line "Rekening koran BCA ·3814 · 1–31 Agu 2026 · IDR · 210 transaksi" + *Bukukan*.
  The manual role form stays behind "Ubah" for the rare case the reader got it wrong.
- Copy in Bahasa Indonesia, sentence case, ui-rules.

## Test seams
- Unit: holder name and bank read from statement headings (BCA PDF fixture, synthetic), entity name matching.
- Unit: synthetic text fixtures mirroring each real layout (BRImo with `0.00` sides, BNI wondr header,
  Mandiri e-Statement header) — the real files never enter the repo. A local-only check runs the reader over
  `data/private/bank-test/` and is recorded in Verification.
- DB integration: import of a statement whose rekening does not exist → confirm path creates rekening + imports;
  multi-file ordering; known number routes to its rekening; Dokumen *Bukukan* on a bank unit with no manual fields.
- e2e: flow 1 (new client, drop, confirm, imported) added to the bank import spec.

## Non-goals
- Creating a rekening silently, or creating entities/clients from a file.
- Foreign-currency bank posting (still refused, unchanged).
- New bank formats or OCR changes.
- Moving Dokumen's general analysis (questions, comparisons) — only its bank statement path changes.
- Using AI to read the statement header: everything here is deterministic.
- AI classification answers cut off at the token limit (most rows fall back to simple guesses) and the 503s /
  1–2 minute imports seen in production: separate follow-ups, they need their own diagnosis.
- The empty Kerangka pelaporan for a newly added pemilik: separate small fix.

## Assumptions
1. The holder name is read best-effort from the statement heading; when absent, the card simply omits it and the
   name check is skipped.
2. The bank of a new rekening comes from the reader's detected format; a GENERIC file (no bank named) asks the user
   to pick the bank in the confirm card.
3. The label of a new rekening defaults to "<Bank> <last four>" (e.g. "BCA 3814"); editable later in Pengaturan.
4. Multi-file import runs files one after another in one request sequence (no background job); the existing 10 MB
   per-file limit stays.
5. A file with several accounts (combined PDF) shows one confirm card listing every new rekening.
6. Real BCA files stay in gitignored `data/private/`; tests use synthetic fixtures only.

## Gate re-openers
None expected: no schema migration (BankAccount already holds bank, number, label, entity), no new dependency,
no AI calls, no change to accounting invariants (the existing pipeline stays the only writer). `app/actions.ts`
is a sensitive path (new server action for confirm + import) — reviewed for tenancy like the existing
`addBankAccountAction`.

## Tasks
- [ ] T0 Reader fixes: BRImo `0.00` side = empty (both sides non-zero still refuses); Mandiri e-Statement and BNI
      wondr headers detected; BNI "PRODUCT - number" rekening — accept: synthetic unit fixtures + the local run
      over all 13 real files reads every one with bank, rekening and printed balances; `verify:books` ALL PASS.
      (reuse: `detectBank`, PDF section reader; parallel with T1)
- [ ] T1 Read holder name from statement headings; expose bank + number + holder + period from a "preview" read
      that writes nothing — accept: unit tests on synthetic BCA PDF/CSV fixtures (reuse: `parseStatementSections`,
      `detectBank`).
- [ ] T2 Import by file: route each section to the rekening with the same number; for unknown numbers return a
      "new rekening" proposal; server action confirms (create rekening + import) — accept: DB tests for known,
      new, mismatch-holder and combined files (reuse: `addBankAccount`, `importStatement`). (deps: T1)
- [ ] T3 Impor Mutasi UI: always-on drop zone, multi-file oldest-first, confirm card, holder warning, per-file
      results, one password prompt per drop; ledger import as secondary — accept: verify flows 1–4 locally. (deps: T2)
- [ ] T4 Dokumen bank path: prefill from the bank reader, one *Bukukan* through T2, manual form behind "Ubah";
      stop confirming country names as currency — accept: verify flow 5. (deps: T2; parallel with T3)
- [ ] T5 e2e flow 1, demo/docs touch-ups, full gate + `verify:books` — accept: full gate green.

## Implementation

## Verification

## Ship Notes

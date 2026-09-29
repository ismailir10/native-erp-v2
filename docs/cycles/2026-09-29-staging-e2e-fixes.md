# Staging E2E fixes — mapping at scale, entity boundary, review safety, AI retry, close & import polish

## Context
A hard E2E on staging (2026-09-29) with real Belifi (BCA + SMBC PDFs), Goers (Neraca) and Chickin (3-sheet GL workbook) files found
5 high, 11 medium and 12 low findings (report kept privately: `data/private/reports/staging-e2e-2026-09-29.md`). The worst: a real
multi-entity ledger can't be mapped at all (bulk accept times out), a Jurnal Penyesuaian can post to another entity's bank account, an
accountant's correction on Review can be lost silently, and when the AI times out every row falls back to "inflow = Penjualan, outflow =
Beban Umum" with no way to ask again. The user asked to fix all of them. Who feels it: the accountant closing a real client's month.

Root causes found in code:
- `acceptMappings()` runs ~2 + 2N + 4K sequential queries in one interactive transaction with Prisma's default 5 s timeout (P2028 on
  Supabase; "Terjadi kesalahan tak terduga" because `fail()` doesn't know Prisma errors).
- `postJournal()` checks the client COA but not that a bank GL account (`BankAccount.accountId`) belongs to the entry's entity; the
  journal form lists every entity's bank accounts.
- Review drafts live only in component state; the base-ui Select is modal, so the first click on *Simpan* while the list is open only
  closes it; Enter is ignored while the previous save is in flight (each save waits a server round trip).
- `merchantKey()` leaves generic keys ("BI FAST OUTGOING", "PINJAMAN LOAN", raw "TRSF E-BANKING DB …" prefixes): memory learns them and
  *Terima N serupa* groups unrelated transfers under them.
- Classification uses `AI_TIMEOUT_MS = 30 s`; the staging model is a reasoning model (kimi-k3). No re-ask path exists.
- Close drafts (*Jelaskan*) read the bank line's classification, not adjusting journals already posted against it.

## Spec
**H — correctness**
- [ ] **H1 Mapping at scale:** accepting 700 source-account mappings incl. 125 new accounts succeeds in one click (one transaction,
      chart read once, new codes allocated in memory, updates batched per target account, `coaVersion` bumped once, explicit timeout).
      Same result as today for small batches. A Prisma timeout anywhere shows Bahasa copy ("Proses terlalu lama …, coba lagi"), not
      "kesalahan tak terduga".
- [ ] **H2 Entity boundary:** `postJournal()` refuses a line on a bank GL account whose `BankAccount.entityId` ≠ the entry's entity
      (LedgerError in Bahasa naming the account and its entity). The Jurnal Penyesuaian account list shows only the selected entity's
      bank accounts. A close control flags any existing line that breaks this (REVIEW `bank-entity:<entity>`), for books posted before the fix.
- [ ] **H3 Review never loses a correction:** an unsaved account/tax change is kept per transaction across refreshes and remounts
      (session storage), the card shows *Belum disimpan*, leaving the page with unsaved changes asks first, and one click on *Simpan*
      saves even when the account list is open (non-modal list). The page count matches the cards shown.
- [ ] **H4 AI failure has a way out:** classification timeout 90 s (env `AI_TIMEOUT_MS` overrides), close review/explain 180 s (env
      `AI_LONG_TIMEOUT_MS`), UI copy says 3 minutes. Errors are Bahasa ("AI tidak menjawab dalam 90 detik"). Review shows a banner when rows
      in scope only have *Tebakan sederhana* with **Minta saran AI untuk N transaksi**: classifies those rows' unique keys (same caps,
      budget, cache, whitelist as import — rule 17/18), updates their suggestion (they stay in review on 1999), reports what changed.
- [ ] **H5 No double correction:** a *Jelaskan* draft that moves a bank line is not postable when an `ADJUSTMENT` of the same entity,
      dated from that line's date to the period end, already moves the same amount off that line's account — the card says which journal
      and offers *Abaikan*. Drafts for a PT/foreign company never use 3300 Prive (account withheld from the model and from the whitelist).

**M — workflow**
- [ ] **M1** Enter/Terima is optimistic: the card leaves at once and the next Enter works while earlier saves finish in order; a failed
      save puts the card back with the error.
- [ ] **M2** Drawer *Ubah akun* on a bank-derived ledger line: pick another account → the reviewer's writer (RECLASS + memory, rule 3);
      refused in a locked month with the lock message.
- [ ] **M3** After changing a card's account, *Simpan untuk N serupa* applies **the chosen** account/tax to the same-key rows. The toast
      says the choice applies to *impor berikutnya*.
- [ ] **M5** Gabungan note no longer claims 1190 "dieliminasi": says matched balances cancel and what remains has no counterpart yet.
- [ ] **M6** Bank reconciliation control skips months that end before the account's books start (the entity's OPENING date, else the
      first statement's start): no "mutasi belum diimpor" before Saldo Awal. Gaps after the start still flag.
- [ ] **M7** Generic merchant keys (only bank-channel words/refs, e.g. BI FAST OUTGOING, TRSF E-BANKING, PINJAMAN LOAN, BIAYA ADM) never
      write or match Memory and never group as *serupa*; "BI FAST" with a space normalises like "BI-FAST".
- [ ] **M8** *Tutup buku* and *Buka kembali periode* ask for confirmation (dialog naming the month and what locking means).
- [ ] **M11** Tanya Buku answers transaction questions ("transfer ke ALFI YANDRA bulan Juni", "pembayaran dari DINA") from bank lines in
      scope: count, total in/out, accounts they sit on, top rows with links to their ledger — deterministic, no AI.

**L — polish**
- [ ] **L1** Toasts get a close button.
- [ ] **L2** Account-mismatch import error shows inline with *Pakai rekening <label>* when the file's number belongs to another account
      of the client (one click re-runs with it).
- [ ] **L3** Combined PDF: sections whose number matches another registered account get *Impor juga ke <label>* (same file, no re-upload).
- [ ] **L4** A re-import with 0 new rows creates no history row; the result CTA points to Review while the client still has rows waiting.
- [ ] **L5** Bank-account pickers list companies before individuals (ui rule 13) and preselect the first company's account.
- [ ] **L6** *Badan usaha asing* hides NPWP.
- [ ] **L7** Saldo Awal PRK row explains the sign ("negatif = utang ke bank, dicatat di kredit").
- [ ] **L8** Jurnal Penyesuaian amounts format on blur (152.000.000); account lists are searchable.
- [ ] **L9** Source-account labels never show the internal `NC:` prefix.
- [ ] **L10** Laporan Keuangan tab is kept in the URL (`?tab=`).
- [ ] **L11** Admin can delete a client: typed client-name confirmation, all its books and imports removed in one transaction, audit
      log line; refused for non-admins.
- [ ] **L12** Review account select is searchable (reuse `AccountPicker`).

**Gate-reopeners (flagged):** (1) accounting invariant tightened — `postJournal` gains the bank-entity check; (2) **new destructive
capability** — L11 deletes a client's posted entries (admin-only, typed confirmation); accounting-rules gets a rule for it; (3) AI credit —
*Minta saran AI* spends calls under the existing caps/budget. No schema migration, no new dependency.

**Non-goals:**
- M4 (serupa grouping principal with fee): re-checked — they have different keys; the grouping was correct.
- M9 (loan text → 2210 while a PRK exists): needs the accountant's judgment; the sign control already flags a debit 2210.
- M10 import speed beyond the AI timeout; L1 toasts "stuck" — sonner pauses timers in a hidden tab (test artifact).
- Mobile pass, Chickin FX (HOLDCO) posting, AI cache purge on client delete (cache rows are keyed by client hash and hold names only).
- Cleaning staging data by SQL — after this ships, the three test clients are deleted with L11.

**Assumptions:**
1. The bank-entity rule applies to every journal kind; no legitimate flow posts one entity's bank account from another entity (cross-entity
   money goes through 1190 in each entity's own books).
2. "Books start" for M6 = the entity's OPENING entry date; without one, the account's first imported statement.
3. Generic-key detection is a fixed word list (bank channel words, transfer/fee/loan words, refs, digits); a key that still has a
   counterparty name is not generic.
4. *Minta saran AI* only touches rows still in review whose method is HEURISTIC; it never posts or accepts.
5. Deleting a client removes its entities, accounts, periods, journals, bank/ledger imports, memories, proposals, invoices, assets,
   schedules, tax records and evidence; firm-level rules, rates and AI cache stay.
6. Timeouts: 90 s classify / 180 s long calls fit Vercel `maxDuration = 300`.

## Tasks
- [x] T1 H1 `acceptMappings` batched + timeout; `fail()` maps Prisma P2028/P2024 — accept: DB test maps 700 sources incl. 125 new accounts
      correctly (codes, names, coaVersion +1) and an error test shows the Bahasa message.
- [x] T2 H2 `postJournal` bank-entity guard, journal form filters by entity, control `bank-entity:` — accept: DB tests (refuse other
      entity's bank; own bank still posts; control REVIEW on legacy line); existing suites green.
- [x] T3 M7 generic merchant keys (no memory write/read, no serupa) + BI FAST normalisation — accept: unit tests on keys; DB test memory not
      written for a generic key; `verify:books` ALL PASS.
- [ ] T4 H3 + M1 + M3 + L12 review queue (drafts in session storage, *Belum disimpan*, beforeunload, non-modal searchable picker,
      optimistic accept, *Simpan untuk N serupa*) — accept: e2e: change account, accept 3 others, reload → draft kept; one click *Simpan*
      saves; serupa with chosen account; Enter ×3 fast accepts 3.
- [ ] T5 M2 drawer *Ubah akun* — accept: e2e reclass from the drawer moves the ledger; locked month shows the lock error.
- [ ] T6 H4 AI timeouts + Bahasa errors + *Minta saran AI* on Review — accept: DB test with MockProvider updates HEURISTIC rows only,
      respects caps; unit test for timeout copy.
- [ ] T7 H5 draft guard vs posted adjustment + no Prive for companies — accept: DB tests (guard blocks post and explains; CV still may use 3300).
- [ ] T8 M6 control start + M8 confirm dialogs — accept: DB test May-before-opening PASS, gap after start still REVIEW; e2e close asks first.
- [ ] T9 L2 L3 L4 L5 import UX — accept: DB test 0-new-rows → no StatementImport; unit/e2e for mismatch suggestion and "impor juga".
- [ ] T10 M5 L6 L7 L8 L9 L10 L1 polish — accept: unit test `NC:` label helper; e2e tab URL; typecheck/lint.
- [ ] T11 M11 Tanya Buku transactions — accept: unit/DB test answers count/total/accounts for a payee in period, cites ledger links.
- [ ] T12 L11 delete client — accept: DB test removes everything for one client and nothing of another; non-admin refused; e2e typed confirm.
- [ ] T13 Rules + docs (accounting-rules: bank-entity guard, generic keys, client deletion; README) — accept: end-of-cycle gates.

## Implementation
- Plan: tasks T1–T13 sequential, done inline (they share review/import/close files and one test DB; no independent slice worth a subagent).
- T1: lib/ledger-import/mapping.ts, lib/db-errors.ts, app/actions.ts, app/settings-actions.ts — acceptMappings reads the chart once, allocates new codes in memory (allocateAccountCode), createMany + updateMany per target account, coaVersion +1 per call, 60 s timeout; Prisma P2028/P2024 → Bahasa message instead of 'kesalahan tak terduga'.
- T2: lib/ledger/post.ts, lib/controls/index.ts, journals/new page + components/app/journal-form.tsx — postJournal refuses a bank GL account of another entity unless the line moves that entity's leftover balance toward zero; REVIEW control bank-entity:<entity> for non-zero leftovers; the form lists only the selected entity's banks and clears other-entity picks on entity change.
- T3: lib/import/normalize.ts (isGenericKey, BI FAST with a space), lib/review.ts, lib/import/pipeline.ts, review + client settings pages — keys naming no counterparty are never learned, never matched from older memories, never a rule (Bahasa error) and never grouped as serupa.
## Verification
- T1 gate: lint ✓ · typecheck ✓ · Test Files 80 passed (80) · Tests 578 passed (578) (new: 700 mappings incl. 120 new accounts in one call; infraErrorMessage).
- T2 gate: lint ✓ · typecheck ✓ · Test Files 80 passed (80) · Tests 579 passed (579) (new: refuse other entity's bank, own bank posts, legacy leftover flagged, over-clear refused, exact clear accepted, control gone).
- T3 gate: lint ✓ · typecheck ✓ · Test Files 80 passed (80) · Tests 581 passed (581) · demo:reset + verify:books → ALL PASS — 1525 pemeriksaan saldo cocok dengan ground truth.
## Ship Notes

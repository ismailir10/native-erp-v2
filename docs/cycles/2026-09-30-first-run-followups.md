# First-run follow-ups — the four items deferred from the first-run flow cycle

## Context
[2026-09-30-first-run-flow](2026-09-30-first-run-flow.md) shipped one guided order (Unggah → Saldo awal → Review → Tutup buku) and
deferred four items, each "needs its own approval". The user approved all four on 2026-09-30 ("do all of them, get them done"), so this
cycle is spec'd for the record and built straight through, with the design decisions below stated instead of asked.

1. **A statement can be imported over an existing Saldo Awal.** `postOpening` refuses an opening dated on/after the first bank
   transaction, but nothing refuses the reverse: import a June statement after a Saldo Awal at 31 Jul and the June rows are counted on top of
   an opening that already contains them, so the bank reconciliation fails without saying why.
2. **A forgotten company, owner or bank account can't be added after "Simpan klien"** (only `addClientAction` exists). The only fix today is
   deleting the client.
3. **Dokumen and Impor Mutasi look like two upload paths.** Nothing tells a new user that Dokumen is evidence to ask questions about (never
   journals) and Impor Mutasi is what makes books.
4. **Beranda and Pekerjaan show the same task list** (Beranda: 3 tasks + "Lihat semua"; Pekerjaan: all). Two menu items, one purpose.

## Spec
- [x] **F1 Opening guard (accounting-rules area, invariant kept: opening precedes activity).** `importStatement` refuses a file whose *new*
      rows (after de-duplication) are dated on or before the entity's OPENING date, with a Bahasa message that names the entity, the
      opening date, the first offending date and the row count, and says what to do (pick a file that starts after that date, or correct
      via Jurnal Penyesuaian). Already-imported rows never trigger it. Same place and error type as the locked-period check.
- [x] **F2 Add a company/owner or a bank account to an existing client**, from *Aturan klasifikasi* (client settings) in a card
      "Perusahaan & rekening": each entity lists its accounts with *Tambah rekening*; *Tambah perusahaan atau pemilik* adds an entity
      (with an optional first account). Domain functions `addEntity` / `addBankAccount` in `lib/onboarding.ts` reuse the same validation
      as `addClient` and the same GL-account allocation (1101–1109, PRK 2201–2209, max 9 each, next free code), in one transaction, tenant
      checked via `getClientForFirm`. No schema change. Adding never rewrites existing books; the bank control starts from the new
      account's first statement (existing behaviour).
- [ ] **F3 Dokumen vs Impor Mutasi copy.** One sentence on each page saying what the other is for, linking to it (Impor: "Dokumen
      dipakai untuk bertanya pada berkas, bukan untuk membuat jurnal"; Dokumen: "Untuk membukukan rekening koran, pakai Impor Mutasi").
- [ ] **F4 One page for the task list.** Beranda is the page. It shows every task when `?tugas=semua` (else the first 3 with a
      "Lihat semua (N)" link); `/work` redirects to `/?tugas=semua` keeping scope and period; the "Pekerjaan" menu item is removed.
- [ ] **F5 Docs + tests.** DB tests for F1 and F2 (incl. tenant and limits), workspace/e2e updates for F4 (investor demo and workspace
      specs), README rows, `ui-rules` unchanged.

**Non-goals:** no schema migration, no new dependency, no AI use; no deleting/renaming an entity or bank account; no change to what
Saldo Awal posts; no import of statements *before* an opening (refused, not re-based); no per-role permissions on the new actions
(same as `addClientAction`: any member).

**Assumptions / decisions made without asking:**
1. F1 **refuses the whole file** (not "skip the early rows") — partial imports would leave a bank reconciliation the user can't explain.
2. F1 compares against the entity's OPENING entry only; a ledger-import (IMPORTED) entity has no bank statements to guard.
3. F2 lives on the existing client settings page (no new route). Bank/entity **removal is out of scope**.
4. F4 keeps `/work` as a redirect so bookmarks and the e2e route list keep working.

## Tasks
- [x] T1 F1 guard in `lib/import/pipeline.ts` + `tests/db/import-opening-guard.test.ts` — accept: import before the opening is refused with the message, after it succeeds, re-import of an existing statement unaffected.
- [x] T2 F2 domain: `addEntity`, `addBankAccount` in `lib/onboarding.ts` + `tests/db/onboarding-add.test.ts` — accept: codes 1101…/2201…, limits, duplicates, foreign client refused.
- [x] T3 F2 UI: server actions + `components/app/entities-card.tsx` on client settings — accept: add a bank and an owner from the page; bank shows in Impor's account list.
- [ ] T4 F3 copy on Impor and Dokumen — accept: both sentences render with a link.
- [ ] T5 F4 Beranda tasks page: `?tugas=semua`, `/work` redirect, sidebar item removed, e2e updated — accept: `/work?scope=…` lands on `/?tugas=semua&scope=…`.
- [ ] T6 F5 docs (README rows, cycle doc), full gate.

## Implementation
- Plan: tasks T1–T6 sequential, inline (small, each independent but sharing files with the shipped cycle).
- T1: `lib/import/pipeline.ts`, `tests/db/import-opening-guard.test.ts`, `accounting-rules` §5 — `importStatement` refuses a file whose not-yet-imported rows are dated on/before the entity's OPENING date (whole file, nothing written), message names the entity, the opening date, the row count and the earliest row, and what to do. Re-importing an already-imported statement is unaffected; an entity with no opening is unguarded.- T2: `lib/setup.ts` (createEntity / createBankAccount / freeGlCodes extracted from createClient; new clients allocate exactly as before), `lib/onboarding.ts` (cleanBank / cleanEntity shared by the new-client form; new `addBankAccount`, `addEntity`), `tests/db/onboarding-add.test.ts` — next free code 1101–1109 (PRK 2201–2209), max 9, a number already on the client is refused, another firm's client/entity is refused; no schema change.
- T3: `app/actions.ts` (`addBankAccountAction`, `addEntityAction`: tenant via `getClientForFirm`, domain errors as `{ok:false, error, fields}`), `components/app/entities-card.tsx` on the client settings page (entities with their accounts and GL codes, inline *Tambah rekening*, *Tambah perusahaan atau pemilik* with an optional first account), a pointer under the account picker on Impor (\"Tambahkan di Aturan klasifikasi\"), `e2e/add-entity.spec.ts`. The 9-account limit shows as a field message.

## Verification
## Ship Notes

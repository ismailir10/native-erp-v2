# Undo an import, and a change log (use-case feedback, cycle 3)

## Context
UC-K4 of the owner's use-case document: changes in the books must reach the TB and the statements, and "menghapus impor menghapus
jurnalnya dan laporan kembali ke keadaan sebelumnya". Today a posted import can't be taken back. A wrong file, the wrong account or a
duplicate period stays in the books until the whole client is deleted. The owner noted there is no button for it.

UC-C8 and UC-K1 also ask that every change has a history ("riwayat (siapa, kapan, dari apa ke apa)"). Buku keeps who posted a journal and
who locked or reopened a month. It doesn't keep:
- who moved a bank line from one account to another;
- the earlier note a control had before it was overwritten;
- who remapped a source account.

Spec approval: the owner said "proceed" after the plan named this cycle (undo an import, account merge, change log). The cycle runs
without a separate stop.

## Spec
- [x] **Hapus impor (UC-K4).** An admin removes a posted bank-statement import or ledger/Neraca import, writing a reason (≥ 10 characters).
      Its bank lines, every journal they or the file produced (bank, reclass, posted corrections) and their drafts go, all in one
      transaction under the client's close lock. The reports return exactly to what they were before the import, and the same file can
      be imported again. Refused with the reason and the way out when:
      - a month it touches is closed;
      - a line settles an invoice;
      - a fixed asset or an adjustment schedule was made from one of its journals.

      A transfer partner in another import loses its link and stays on its account, so the clearing control shows the open half.
- [x] **The removal is recorded.** One change-log event keeps: the file, the account or entity, the period, the row count, money in and
      out, the journal count, the net it took off each account, the reason, who and when. Never edited.
- [x] **Change log (UC-C8).** An append-only `AuditEvent` per client (who, when, kind, subject, a Bahasa summary, before → after). It is
      written in the same transaction as:
      - a reviewer moving a bank line to another account or tax tag;
      - *Lepas pasangan*;
      - an import removed;
      - a control note written or replaced (the replaced note is kept);
      - a source-account mapping changed;
      - a Temuan resolved.
- [x] **Where it shows.** A client page *Riwayat perubahan*, newest first, filterable by kind. The ledger drawer shows a bank line's own
      history.
- [x] **Golden proof (UC-K4).** In the golden test, removing one month's statement brings every key number back to what it was before
      that file, and importing it again brings back the key.

**Non-goals:** account merge. Buku has no merge, and the risky case in the document (cash merged into another account so it no longer ties
to the bank) can't happen: a bank GL account belongs to one `BankAccount` and its entity (rule 2), and remapping a source account never
moves posted lines (rule 9a). A real merge needs its own design. Also out: removing a Saldo Awal entered by hand (it is corrected by
adjustment or Temuan); an approval workflow for removals; history for journal entries (they already carry who posted them and are
immutable).

**Gate-reopeners (flagged):**
- **Schema migration:** `AuditEvent`.
- **Accounting invariant:** rule 3 ("posted entries are immutable") gains a second exception beside deleting a client — removing a whole
  import in open months, admin only, with a reason and a permanent log (ADR 0013). Physical removal, not reversal, is chosen because
  reversal would leave the bank lines in place: the same file could never be imported again (rows dedupe by hash), and every reader of bank
  lines would have to skip voided ones.
- No new dependency. No AI.

**Assumptions:**
1. Memory learned from the removed lines stays. It records decisions about counterparties, which remain true.
2. A removed Neraca import (Saldo Awal from a file) is removable the same way. The setup steps ask for Saldo Awal again.
3. Removal is admin only, like reopening a month.

## Tasks
- [x] T1 Schema + ADR: `AuditEvent` model and migration, `lib/audit.ts` (`recordEvent`, `listEvents`), ADR 0013, accounting-rules rule 3
      amended, `deleteClient` covers the table. Accept: migrate diff empty, tests green.
- [x] T2 Hapus impor: `lib/imports/remove.ts` (`removeStatementImport`, `removeLedgerImport`), actions, buttons with a reason dialog on the
      Impor page and the ledger import page. Accept: DB tests (exact restore, re-import, every refusal, partner unlinked, the event).
- [x] T3 Change log writers (review, unpair, control note, mapping, Temuan) + *Riwayat perubahan* page + the drawer history. Accept: DB
      tests per writer; page renders.
- [x] T4 Golden removal proof. Accept: the golden test removes and re-imports one statement.
- [ ] T5 End-of-cycle gates, review pass, ship.

## Implementation
- Plan: T1–T5 sequential, inline (the log table first: every later task writes to it).
- T1: `AuditEvent` + migration `20261003010000_audit_event` (with a trigger that refuses UPDATE: append-only in the database, not only by
  convention), `lib/audit.ts` (`recordEvent`, `listEvents`, kind labels), `lib/clients/delete.ts`, ADR 0013 (+ index). The rule 3
  amendment ships with T2, where removal lands. Test: `tests/db/audit.test.ts`.
- T2: `lib/imports/remove.ts` (`removeStatementImport`, `removeLedgerImport`: admin + reason; under the close lock; refusals for closed months,
  settlements, schedules/assets made from its journals, reversed journals; unlinks a transfer partner elsewhere; drops drafts and posted
  proposals that cite or came from what goes; clears evidence selections; one `IMPORT_REMOVED` event with file, account, period, rows,
  money in/out, journals and the net per account), `removeImportAction`, `components/app/remove-import.tsx` (reason dialog), admin-only
  *Hapus* on the Impor page's statement history and on a posted ledger import's page; accounting-rules rule 3 amended. Test:
  `tests/db/remove-import.test.ts`.
- T3: events written in the same transaction by `reviewTransactionTx` (only when account, tax or withholding actually change),
  `unpairTransfer` (one per half), `lib/controls/ack.ts` `saveControlNote` (the action now goes through it; a replaced note is the
  event's *before*), `acceptMappings` (remaps only — a first mapping belongs to its import), `resolveOpeningFinding`. Page
  `/clients/[id]/history` (*Riwayat perubahan*, filter by kind, under *Pengaturan klien*); ledger drawer *Riwayat* for a bank line
  (`lib/reports/account-ledger.ts`). Test: `tests/db/audit-writers.test.ts`.
- T4: `lib/demo/golden.ts` `reviewWithTruth` (factored out of `seedGolden`); `tests/db/golden.test.ts` removes June's PT BCA statement — the app
  then equals `goldenKey` of the same scenario without those lines (the generator's own answer, not a snapshot) — and imports it again to
  the committed key. The trap's withdrawal and a 1199 sweep and the PT → owner loan are in that file, so their other halves stay behind.

## Verification
- T1: `prisma migrate deploy` on both DBs → applied; `prisma migrate diff --from-config-datasource --to-schema` → "This is an empty migration.";
  `npx vitest run tests/db/audit.test.ts` → `Tests 1 passed (1)`; lint + typecheck clean; `npm test` → `Test Files 130 passed (130) · Tests 941 passed (941)`.
- T2: `npx vitest run tests/db/remove-import.test.ts` → `Tests 3 passed (3)`; lint + typecheck clean; `npm test` → `Test Files 131 passed (131) · Tests 944 passed (944)`.
- T3: `npx vitest run tests/db/audit-writers.test.ts` → `Tests 2 passed (2)`; lint + typecheck clean; `npm test` → `Test Files 132 passed (132) · Tests 946 passed (946)`;
  `demo:reset && verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T4: `npx vitest run tests/db/golden.test.ts` → `Tests 8 passed (8)`.

## Ship Notes

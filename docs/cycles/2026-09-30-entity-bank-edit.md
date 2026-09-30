# Rename and remove companies and bank accounts

## Context
The first-run follow-ups let a member *add* a company/owner or a bank account after "Simpan klien". A wrong name, a typo'd account number or a
company entered by mistake still can't be fixed short of deleting the whole client. The user asked for **rename and remove** for both, tested
hard "as an accountant": books must never be corrupted, and nothing that has posted entries can disappear.

What an accountant needs to be true:
- **Names are labels, numbers are not.** A rename never moves a figure, a journal or a period. But the bank GL account name is built from
  `label (shortName)` (`lib/setup.ts`), so it must follow, or the Neraca would show the old name.
- **Posted entries are immutable (rule 3).** So an entity or bank account that any journal, bank row, statement import, Saldo Awal, ledger mapping,
  invoice, asset, lease, employee, schedule or tax record points to can't be removed. Removal is for things entered by mistake and still empty.
- **A bank account's number is what statements are matched against** (`AccountMismatchError`); changing it after imports would orphan them.
- The ledger import matches file rows to entities by short name: duplicates would make that ambiguous.

## Spec
- [x] **E1 Rename a company/owner:** name, short name (unique per client, case-insensitive), NPWP (same check as creation, blank clears, not for a
      foreign entity). Kind, currency and reporting framework are not editable here. Allowed in any period state (labels only; no journal, period
      or figure is touched). The GL names of that entity's bank accounts (`label (shortName)`) are renamed in the same transaction.
- [x] **E2 Edit a bank account:** label always (its GL account name follows). Bank and number only while it has no statement import and no bank
      row (same number rules as creation, unique on the client); afterwards the message says why. The PRK flag is never editable (it decides the GL account type).
- [x] **E3 Remove a bank account** only when nothing points to it: no statement import, no bank row, no journal line on its GL account, no
      ledger source-account mapping, tax credit/correction, invoice or schedule using that GL account, no bank row classified to its code.
      Deletes the account and its GL account. **Admin only.** Freed codes are reused by the next add.
- [x] **E4 Remove a company/owner** only when nothing at all points to it (journals including Saldo Awal, bank rows and imports, source accounts,
      invoices, fixed assets, leases, employees and benefit records, adjustment schedules and proposals, tax years, CKPN settings, evidence
      selections) and only if the client keeps at least one entity. Deletes its (empty) bank accounts with their GL accounts. **Admin only.**
- [x] **E5 UI on *Perusahaan & rekening*:** *Ubah* on each company and account (inline form), *Hapus* with a two-step confirm. When removal is not
      possible the button is disabled and the **reason is written next to it** ("Sudah ada 12 jurnal dan 3 mutasi bank. Koreksi lewat Jurnal
      Penyesuaian."), computed on the server from the same checks the action re-runs. Akuntan sees Ubah, not Hapus.
- [x] **E6 Hard tests (DB, action, e2e):** every refusal leaves every row count unchanged; a rename leaves trial balance, Laba Rugi, Neraca and
      close controls identical (including in a locked period); tenant isolation; role gate; FK backstop; and `verify:books` still ALL PASS after
      renaming every entity and account of the demo firm.

**Non-goals:** no schema change or migration; no change of kind, currency or PRK; no merging of two entities; no moving of a bank account
between entities; no deletion of anything with posted entries (correct by Jurnal Penyesuaian, or delete the client as an admin);
**no audit-log table** (would need a migration; a rename leaves no history row — flagged in Ship Notes).

**Assumptions / decisions made without asking:**
1. Removal is **admin-only** (like *Hapus klien*); rename is any member.
2. NPWP is editable together with the name (a legal rename usually corrects it); blank clears it.
3. Renaming a company in a locked period is allowed: it changes labels on reports, never numbers.
4. The database foreign keys are the last line of defence: a delete that races a concurrent import fails and says so instead of cascading.

## Tasks
- [x] T1 `lib/clients/entities.ts`: usage checks + rename/edit/remove domain + `tests/db/entity-edit.test.ts` — accept: every rule above, incl. refusals leave data untouched.
- [x] T2 Server actions (admin gate, tenant) + `tests/db/entity-edit-action.test.ts` — accept: akuntan can rename, cannot remove; foreign firm refused.
- [x] T3 UI in `entities-card.tsx` + settings page wiring (reasons computed server-side) — accept: buttons and reasons render for each state.
- [x] T4 e2e (`add-entity.spec.ts` extended) and the demo-firm rename check with `verify:books` — accept: recorded in Verification.
- [x] T5 Docs (README, cycle doc), full gate, PR.

## Implementation
- Plan: T1–T5 sequential, inline (each builds on `lib/clients/entities.ts`).
- T1: `lib/clients/entities.ts` (`bankAccountUsage`, `entityUsage`, `blockedReason`, `renameEntity`, `updateBankAccount`, `removeBankAccount`, `removeEntity`), `lib/onboarding.ts` (cleaning helpers exported; adding an entity now also keeps short names unique), `tests/db/entity-edit.test.ts` (22 tests).
- T2: `app/actions.ts` (`renameEntityAction`, `updateBankAccountAction` any member; `removeBankAccountAction`, `removeEntityAction` admin only, logged like *Hapus klien*; "client not found" is a plain message), `tests/db/entity-edit-action.test.ts`.
- T3: `components/app/entities-card.tsx` (Ubah on companies and accounts, Hapus with a second click; a blocked Hapus is disabled and the reason is text beside it; bank/number fields disabled with the reason once statements exist), `app/(app)/clients/[id]/settings/page.tsx` (reasons from the same functions the action re-runs; Akuntan gets no Hapus).
- T4: `e2e/add-entity.spec.ts` second test (books present → both blocked with reasons, number locked, renames, the two empty things removed); demo-firm check below.
- T5: README, `accounting-rules` §3, this doc.
## Verification
- Full gate on the last code commit (each run just now in this sandbox): `npm run lint` clean · `npm run typecheck` clean · `npm test` → `Test Files 114 passed (114)`, `Tests 857 passed (857)` (new: entity-edit 22, entity-edit-action 3) · `npm run build` compiled · `npm run demo:reset && npm run verify:books` → `ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.`
- **Accountant's check on the whole demo firm** (4 entities, 6 bank accounts, 401 journal entries, 897 lines, 371 bank rows; throw-away script, not committed): renamed every entity and bank account (10 renames) → tried to remove every bank account and entity (10 attempts) → **all 10 refused**; row counts before/after `[4,6,213,401,897,371]` = `[4,6,213,401,897,371]`; trial balances of all clients at 31 Aug 2026 identical; renamed everything back (names, short names, NPWP identical to the originals) → `verify:books` ALL PASS. (Renamed, `verify:books` cannot find the entities: it looks them up by name — a property of the checker, not of the books.)
- What the DB tests pin down: rename moves no figure (trial balance, Laba Rugi, control statuses, journal debit/credit totals, all row counts identical, also with the month LOCKED); every refusal leaves every row count unchanged; a removal of an empty account/company deletes its GL account and frees the code; last entity kept; foreign firm/client refused for each function; the foreign-key backstop (a delete racing a concurrent import fails with a message and cascades nothing) via a database whose pre-checks read "empty".
- `npm run test:e2e` is not runnable in this sandbox (Supabase Auth and cdn.sheetjs.com are blocked; `xlsx@0.18.5` stands in locally, untracked). CI runs it; the new second test in `e2e/add-entity.spec.ts` has never run yet. Nobody has looked at the card in a browser.
## Ship Notes
- Migrations: none. Env vars: none. No new dependency, no AI. Accounting invariants kept (posted entries immutable; a removal never deletes an entry). `verify:books` ALL PASS.
- Behaviour to know: removal is admin only and logged to the server log (`entity removed: …`, `bank account removed: …`); there is **no audit table** (would need a migration), so a rename leaves no history row.
- Adding an entity now also refuses a short name another entity of the client already has (the ledger import matches file rows by short name).
- Rollback: revert the merge commit; nothing stored depends on it (a removed company can be added again, as it had no books).

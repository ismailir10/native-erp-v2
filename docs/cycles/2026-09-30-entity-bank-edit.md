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
- [ ] **E1 Rename a company/owner:** name, short name (unique per client, case-insensitive), NPWP (same check as creation, blank clears, not for a
      foreign entity). Kind, currency and reporting framework are not editable here. Allowed in any period state (labels only; no journal, period
      or figure is touched). The GL names of that entity's bank accounts (`label (shortName)`) are renamed in the same transaction.
- [ ] **E2 Edit a bank account:** label always (its GL account name follows). Bank and number only while it has no statement import and no bank
      row (same number rules as creation, unique on the client); afterwards the message says why. The PRK flag is never editable (it decides the GL account type).
- [ ] **E3 Remove a bank account** only when nothing points to it: no statement import, no bank row, no journal line on its GL account, no
      ledger source-account mapping, tax credit/correction, invoice or schedule using that GL account, no bank row classified to its code.
      Deletes the account and its GL account. **Admin only.** Freed codes are reused by the next add.
- [ ] **E4 Remove a company/owner** only when nothing at all points to it (journals including Saldo Awal, bank rows and imports, source accounts,
      invoices, fixed assets, leases, employees and benefit records, adjustment schedules and proposals, tax years, CKPN settings, evidence
      selections) and only if the client keeps at least one entity. Deletes its (empty) bank accounts with their GL accounts. **Admin only.**
- [ ] **E5 UI on *Perusahaan & rekening*:** *Ubah* on each company and account (inline form), *Hapus* with a two-step confirm. When removal is not
      possible the button is disabled and the **reason is written next to it** ("Sudah ada 12 jurnal dan 3 mutasi bank. Koreksi lewat Jurnal
      Penyesuaian."), computed on the server from the same checks the action re-runs. Akuntan sees Ubah, not Hapus.
- [ ] **E6 Hard tests (DB, action, e2e):** every refusal leaves every row count unchanged; a rename leaves trial balance, Laba Rugi, Neraca and
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
- [ ] T1 `lib/clients/entities.ts`: usage checks + rename/edit/remove domain + `tests/db/entity-edit.test.ts` — accept: every rule above, incl. refusals leave data untouched.
- [ ] T2 Server actions (admin gate, tenant) + `tests/db/entity-edit-action.test.ts` — accept: akuntan can rename, cannot remove; foreign firm refused.
- [ ] T3 UI in `entities-card.tsx` + settings page wiring (reasons computed server-side) — accept: buttons and reasons render for each state.
- [ ] T4 e2e (`add-entity.spec.ts` extended) and the demo-firm rename check with `verify:books` — accept: recorded in Verification.
- [ ] T5 Docs (README, cycle doc), full gate, PR.

## Implementation
## Verification
## Ship Notes

# Fix: Tambah klien rejects the form with no visible reason

## Context
The owner tried Tambah klien on production 5 times and gave up ("doesn't work"). Logs show 5 POSTs, all 200, no
server errors, and no client created. Reproduced: the action rejected the form one field at a time with a toast
("Isi nama setiap entitas.", then "Isi nama rekening…"). The toast vanishes after a few seconds and no field is marked.
"Nama rekening" was required but nothing said so, and the entity name had to be typed again even when it is the client.
The save path itself works (a full form saved and redirected to Saldo Awal).

## Spec
- [x] All problems are returned at once, keyed by field (`OnboardingError.fields`), and shown under each field
      (`FieldError`, `aria-invalid`). Focus moves to the first marked field. Errors clear as the field is edited.
- [x] Only client name, entity name and account number are required. The account name defaults to "BCA ••5566",
      the short name to the full name, and industry and NPWP stay optional.
- [x] The first entity's name follows the client name until the user edits it (skipped for Perorangan).
- [x] Server still validates bank code, NPWP shape, 6–20-digit account numbers, duplicates, and ≤ 9 accounts.

**Non-goals:** client edit/delete, layout changes beyond the error slots.
**Assumptions:** none new; no migration, dependency or invariant change.

## Tasks
- [x] T1 Field-level validation + inline errors + optional account name + name prefill — accept: DB tests; browser: empty submit marks 3 fields, 3-field submit saves

## Implementation
- `lib/onboarding.ts` hand-written validation collecting every error (replaces the zod first-issue mapping); `app/actions.ts` returns `fields`;
  `components/app/client-form.tsx` shows them inline, focuses the first, and prefills the entity name.

## Verification
- Browser (local): empty submit showed "Isi nama klien.", "Isi nama badan usaha.", "Isi nomor rekening." under their fields, with focus on Nama klien and no toast.
  Typing the client name filled Nama lengkap. Adding the number and saving went to Saldo Awal with "1101 BCA ••3477".

## Ship Notes
- No migration, no env change. Rollback: revert.

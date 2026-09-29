# Duplikat lintas sumber — satu mutasi dari dua file rekening koran

## Context
Examining Belifi's Drive (2026-09-29): June 2026 exists twice — the bank's e-statement PDF and the accountant's Excel working copy
(May–Jul). Both parse and reconcile (31 rows, opening Rp 156.680.500 → closing Rp 4.635.500), but only 18 of 31 rows share the row hash:
the copy rewords 13 descriptions, and the BCA PDF prints the balance only on a day's last line. Importing both would post 13
transactions twice; the bank reconciliation would FAIL only after the fact.

## Spec
- [x] A row is also a duplicate when the bank account already has a line, not yet matched, with the same date and amount (matched one to
      one; the balance only picks among twins, since a source that missed a line has every later balance off). Same file again = same hash, as before.
- [x] The import says it: "N baris sama dengan mutasi yang sudah diimpor dari file lain (tanggal dan nominal sama, keterangan berbeda);
      dilewati." — returned and stored with the import's notes.
- [x] A genuine extra line (a second same-day transfer of the same amount) is still imported.

**Non-goals:** merging descriptions from both sources; flagging a line dropped wrongly (the bank reconciliation does).
**Assumptions:** two sources of one bank account's statement are the same bank lines; the bank reconciliation catches either mistake.

## Tasks
- [x] T1 Pipeline dedupe + DB test + real-file proof — accept: gates green; Belifi workbook then June PDF → 0 new rows, recon PASS.

## Implementation
- T1: `lib/import/pipeline.ts` (exact hash first, then one-to-one date + amount twins, balance as tie-break; note), `tests/db/import-workbook.test.ts`.
  Found while testing: requiring equal balances missed every line after one the Excel copy lacked — the balance now only chooses the twin.

- Review of #53: matching across sources now needs coverage — every line already imported within the new file's statement period has a twin in the file; a supplement or partial slice keeps its lines and gets a note to check the bank reconciliation. The dedupe runs again inside the write transaction under a per-bank-account advisory lock; if a concurrent import changed the answer, the import refuses and asks to retry. Tests: supplement kept, concurrent copies never double-post. Real files unchanged (31 of 31 skipped, recon PASS). Gates: `Tests 555 passed`, build ✓, e2e 14 passed, `verify:books` ALL PASS.

## Verification
- Real files (local scratch firm, reseeded after): Belifi Excel copy May–Jul, then the bank's June PDF → `pdfRows 31, duplicates 31 (18 by hash + 13 from the other source), new rows 0`; recon PASS May Rp 156.680.500, June Rp 4.635.500, July Rp 359.000.
- Gates: lint ✓ typecheck ✓ `Test Files 75 passed (75) · Tests 553 passed (553)` · build ✓ · `npx playwright test` → `14 passed` · `verify:books` → `ALL PASS — 1477 pemeriksaan saldo cocok dengan ground truth.`

## Ship Notes
- No migration, env or dependency. Rollback: revert the merge.

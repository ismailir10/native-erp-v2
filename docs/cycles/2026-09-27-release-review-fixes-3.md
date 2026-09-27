# Release review fixes, round 3 (staging → main)

## Context
The review of the promotion PR (#37) at cc95efd found two more defects in earlier staging code: a race in the file-rate writer
(#20's fill-empty-only rule) and scoped *Tanya Buku* "what is missing" answers that ignored the chosen scope. Both ship before the
release merges.

## Spec
- [x] A rate taken from an imported file is inserted only (ON CONFLICT DO NOTHING): two imports racing for the same empty date keep
      the first rate and both see it; neither overwrites the other (accounting-rules 6b).
- [x] A MISSING question with an entity or period leaves out problem documents and open conflicts whose versions are known to be
      outside that scope (every unit excluded); anything of unknown scope stays in.

**Non-goals:** other evidence intents; the Kurs page's manual upsert (an explicit accountant edit may replace a rate).
**Assumptions:** a conflict is out of scope only when every version it references is.

## Tasks
- [x] T1 Insert-only file rates; scope the missing-documents answer — accept: new tests fail on the old code

## Implementation
- T1: `lib/fx/rates.ts` `upsertFileRate` — `createMany({ skipDuplicates })` then read the row that landed.
  `lib/evidence/answers.ts` — `sourceScope` also returns `versionOut(versionId)` (the version has units and all are excluded); the
  MISSING branch drops documents whose current version and conflicts whose versions are all out. Tests: `tests/db/rates.test.ts`
  (five concurrent pairs, both callers see the stored rate), `tests/db/evidence-scope.test.ts` (a 2023-only file and its conflict
  drop out of a December 2024 question; an unknown-period file's conflict stays). Rule 6b wording.

- Review of #40: a document that was processed once and later went ERROR/MISSING keeps its last version, but scope was computed only
  from READY documents' versions, so such a document was never recognised as out of scope. The MISSING branch now scopes those
  retained versions and the versions its conflicts cite (scoped only, never searched). The test's 2023 file is now an ERROR document;
  fails on the previous code.

- Review of #40 (4790b6c): the "N bagian belum dikonfirmasi" note was computed before those retained versions were added, so a kept
  exception of unknown scope went unexplained. The MISSING branch now replaces the note with the count from the expanded scope. The
  test adds a failed file with an undated sheet: it stays in and the note says 2; fails on the previous code.

- Review of #40 (cdb8251): (1) two imports staged while a rate date was empty and then posted in turn: the second silently kept its own,
  different rate on its lines while the Kurs table kept the first. `postImport` now compares each file rate with the row that landed
  and, where they differ and staging didn't already flag that pair, adds the same `FX_FILE_RATE_DIFFERS` REVIEW check (so the
  close asks for a note); the grouping/wording is shared (`rateDiffChecks`). (2) the missing-documents list used all 501 fetched rows
  while scoping only the first 500; both now use the first 500. Tests in `tests/db/rates.test.ts` and `tests/db/evidence-scope.test.ts`
  fail on the previous code.

## Verification
- T1: new tests fail on the previous code (2 failed | 10 passed; the rate race reproduces), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 437 passed (437); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (55.4s).
- Review of #40: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 437 passed (437); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (54.8s).
- Review of #40 (4790b6c): lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 437 passed (437); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (53.2s).
- Review of #40 (cdb8251): lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 439 passed (439); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (51.8s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

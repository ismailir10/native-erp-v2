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

## Verification
- T1: new tests fail on the previous code (2 failed | 10 passed; the rate race reproduces), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 437 passed (437); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (55.4s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

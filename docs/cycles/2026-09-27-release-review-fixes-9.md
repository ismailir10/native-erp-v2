# Release review fixes 9

## Context
The review of the staging → main promotion (#37, head a5a2077) found a gap in the Neraca reader. Some Neraca files start directly
with an asset sub-heading ("Current Assets", "Fixed Assets", "Other Assets") and have no "Assets" row above it. The reader then
recorded the sub-heading's term but left the section empty. Rows under it were typed from their code numbering, so a 2-coded fixed
asset came in as LIABILITAS and could be suggested a liability account such as 2300.

## Spec
- [x] English asset sub-headings (current / fixed / other / non-current / intangible / tangible assets) open the ASET section as well
      as setting the term. A row under them is typed ASET whatever its code numbering (accounting-rules 9a, 15a).

- [x] Review round 2 (#46): "Intangible Assets" / "Tangible Assets" (and "aset tak/tidak berwujud") are long-term (NON_CURRENT)
      too, whether they open the file or follow "Current Assets".

- [x] Review round 3 (#46): the long-term term matcher covers every asset sub-heading the section matcher accepts other than "Current",
      in both singular and plural forms (e.g. "Other Asset").

**Non-goals:** new heading vocabularies beyond these asset sub-headings. Indonesian "Aset …" / "Aktiva …" headings already
match the main asset heading.
**Assumptions:** these sub-headings never name a liability or equity section.

## Tasks
- [x] T1 Asset sub-headings open the ASET section — accept: new tests fail on the old reader
- [x] T2 Intangible / tangible asset headings are NON_CURRENT — accept: new case fails on the previous reader
- [x] T3 Singular asset sub-headings take the same term — accept: new case fails on the previous reader

## Implementation
- T1: `lib/ledger-import/read.ts` adds `SECTION_ASSET_SUB` next to `SECTION_ASSET`. Tests:
  - `tests/unit/ledger-read.test.ts`: a Neraca starting at "Current Assets", with a 2-coded row under "Fixed Assets" and a
    9-coded row under "Other Assets", reads ASET with CURRENT / NON_CURRENT terms.
  - `tests/db/neraca-term.test.ts`: the 2-coded fixed asset stores typeHint ASET, and its suggestion (if any) is an asset account.
- T2: `TERM_NON_CURRENT` adds `(in)?tangible assets?`, `tak berwujud` and `tidak berwujud`. The unit test covers a Neraca opening at
  "Tangible Assets", then "Current Assets", then "Intangible Assets": NON_CURRENT / CURRENT / NON_CURRENT. The first case now
  uses "Intangible Assets" in place of "Other Assets".
- T3: `TERM_NON_CURRENT` uses `(fixed|other|intangible|tangible)\s+assets?`, the same words as `SECTION_ASSET_SUB`. The unit test adds
  "Current Asset" (CURRENT), then "Other Asset" (NON_CURRENT) after it.

## Verification
- T1: both new tests fail on the old reader (unit: rows untyped under "Current Assets" / "Fixed Assets"; DB: "expected
  [ 'LIABILITAS', 'NON_CURRENT' ] to deeply equal [ 'ASET', 'NON_CURRENT' ]") and pass after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 455 passed (455).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (51.9s).
- T2: the new case fails on the previous reader ("expected [ [ '2-1500', 'ASET', null ], …"; the term stayed null) and passes after.
- T2 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 455 passed (455).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (50.4s).
- T3: the new case fails on the previous reader (the singular "Other Asset" row kept CURRENT) and passes after.
- T3 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 455 passed (455).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (49.7s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

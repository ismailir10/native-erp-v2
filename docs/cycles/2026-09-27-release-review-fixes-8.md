# Release review fixes 8

## Context
The review of the staging → main promotion (#37, head 1f7a0b5) found one more gap in the close copilot. The ledger anomaly scans
(flux, flip, dormant, duplicates) cite journal rows as `jl:<lineId>` or `je:<entryId>`, even when the row came from a bank line.
`reclassedBankLine()` matched citations only against raw bank transaction ids, so it found none. A correction of such a row was
then stored and posted as a free ADJUSTMENT. That left the bank line's account, review state, tax handling and Memory unchanged,
while the GL was offset separately (rule 3).

## Spec
- [x] A cited journal line or entry resolves to the bank line behind it, so a draft that moves it is a reclassification through
      the reviewer's writer. A draft that moves it any other way gets no draft (accounting-rules 20b).

- [x] Review round 2 (#45): the check also runs when a draft posts. An AI draft with no bank line attached is refused if a bank line
      it cites (directly or through its journal row) sits on an account the draft touches. This covers drafts stored before this fix.

- [x] Review round 3 (#45): every account a bank line posts to (its classification, a tax split, suspense) counts as part of that
      line, both when a draft is made and when it posts. A draft moving only a cited PPN component gets no draft, and a stored one
      is refused.

**Non-goals:** changing what the anomaly scans cite.
**Assumptions:** only the entry's own `bankTransactionId` links a journal row to a bank line (rule 15 lineage).

## Tasks
- [x] T1 Resolve `jl:`/`je:` citations to their bank line — accept: new test fails on the old code
- [x] T2 Refuse stored free drafts that would move a cited bank line — accept: new test fails without the posting check
- [x] T3 A bank line's tax split counts as the line — accept: both new checks fail on the previous code

## Implementation
- T1: `lib/controls/explain.ts` adds `citedBankIds`. It adds to the cited ids the `bankTransactionId` of each cited journal line's
  entry and of each cited entry, within the entity. `reclassedBankLine` then looks up bank lines by those ids. The test in
  `tests/db/close-explain.test.ts` covers:
  - Citing the reclass line on 4100, or its entry, resolves to that bank line.
  - A split draft citing the line is AMBIGUOUS.
  Rule 20b wording updated.
- T2: `citedBankIds` moves to `lib/controls/cited.ts`, shared by `lib/controls/explain.ts` and `lib/adjust/proposals.ts`.
  `postProposal` refuses an AI draft without `bankTransactionId` when a cited bank line's account is among the draft's lines or
  the chosen accounts: "Draf ini memindahkan transaksi bank, jadi harus lewat Review". Test in `tests/db/close-explain.test.ts`:
  - The duplicate scan cites the bank line's own entry as `je:`.
  - A draft stored the old way (fresh snapshot, grounded, no bank line) is refused.
  - The bank line stays on 4100 and no free journal is written.
- T3: `lib/controls/cited.ts` adds `bankLineAccounts`, which gives each bank line every non-bank account its postings use.
  `reclassedBankLine` and the posting check in `postProposal` compare against that set instead of `accountCode` alone.
  The test covers the taxed line's 2130 component, cited as `jl:`:
  - A draft moving only that component is AMBIGUOUS.
  - A stored draft citing it is refused when it posts.

## Verification
- T1: the new test fails on the previous code ("expected null to be '<bank tx id>'": the draft would be a free journal) and passes after.
- Gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 452 passed (452).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (55.4s).
- T2: the new test fails without the posting check ("promise resolved … instead of rejecting": the old draft posted as a free
  journal) and passes with it.
- T2 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 453 passed (453).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (52.2s).
- T3: both checks fail on the previous code (draft: "expected null to be 'AMBIGUOUS'"; posting: it reached the snapshot check,
  "Buku berubah …", instead of the bank-line refusal) and pass after.
- T3 gates:
  - Lint and typecheck clean.
  - `npm test` → Test Files 61 passed (61), Tests 453 passed (453).
  - `npm run build` ✓.
  - `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
  - `test:e2e` → 10 passed (48.8s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the promotion PR #37.

# Release review fixes, round 2 (staging → main)

## Context
The review of the promotion PR (#37) at 49a6ecc found two more defects in code already on staging: a close-copilot draft that moves
several bank lines at once posted as a free adjustment, and a 1999 correction could reverse a difference that was already cleared.
Both would leave the books wrong after a click, so they ship before the release merges.

## Spec
- [x] A draft that moves cited bank lines in any shape other than one two-line reclass gets **no draft** (the explanation stays),
      never a free ADJUSTMENT that leaves the bank lines' coding, review state, tax and Memory out of step (rules 3, 20b).
- [x] A 1999 correction is offered and posted only while the entity's 1999 balance through that month still holds the difference
      (on its side, at least its amount); the posting re-checks it inside its serializable transaction (rule 15a).

**Non-goals:** multi-line bank reclassification through the reviewer's writer; any other change.
**Assumptions:** "still holds" is read from the same balance the ledger control uses (the entity's 1999 through the month-end).

## Tasks
- [x] T1 Refuse multi-bank-line drafts; offer/post a 1999 correction only while outstanding — accept: new tests fail on the old code

## Implementation
- T1: `lib/controls/explain.ts` `reclassedBankLine` — any cited bank line the entry takes off its account makes the draft a reclass;
  only a single two-line one is representable, anything else is "AMBIGUOUS" (no draft). `lib/adjust/suspense.ts` `outstanding()` —
  1999 balance check used when listing and, through a new `guard` hook on `postProposal` (run first inside its serializable
  transaction), when posting. Tests: `tests/db/close-explain.test.ts` (a four-line draft citing both loan lines → no draft),
  `tests/db/suspense-corrections.test.ts` (a difference cleared by a manual adjustment is neither offered nor postable).
  Rules 15a / 20b wording.

- Review of #39: a split reversal of a cited bank line (e.g. Rp 60 jt + Rp 40 jt off 4100) matched no full-amount line and slipped
  through as a free ADJUSTMENT. Now any line on a cited bank line's current account counts as moving it; only the single two-line
  reclass gets a draft. `reclassedBankLine` is exported and tested directly (split → no draft, exact reclass → that line); fails on
  the previous code.

- Review of #39 (aa2f241): differences that offset each other (1999 credited 10, debited 5) left no line that fits the remaining
  balance, so no correction was offered while the import still FAILed. Also, bank lines waiting in Review are parked on 1999, so the
  balance must leave them out. `lib/controls/suspense-net.ts` `sourceSuspenseNet` (1999 without bank-line entries) now feeds the
  per-line check, a new **remaining-balance correction** (`net:<entity>:<y>-<m>`, anchored on the month's latest source line for its
  file and row; offered when no single line fits; posting re-checks the balance is unchanged), and the ledger control's FAIL. Tests:
  offsetting differences → one correction for the rest, posts to zero; a 1999-parked bank line doesn't hide a correction. Both fail
  on the previous code.

## Verification
- T1: new tests fail on the previous code (2 failed | 7 passed), pass after. Gates: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 433 passed (433); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (56.5s).
- Review of #39: lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 433 passed (433); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (53.5s).
- Review of #39 (aa2f241): lint + typecheck clean; `npm test` → Test Files 61 passed (61), Tests 435 passed (435); `npm run build` ✓; `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth; `test:e2e` → 10 passed (53.5s).

## Ship Notes
No migration, no env change. Merges to staging, then rides the open promotion PR #37.

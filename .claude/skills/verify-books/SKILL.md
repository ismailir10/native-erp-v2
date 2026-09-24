---
name: verify-books
description: Three-layer verification for any change that can move a number on a Buku report (parsers, classifier, posting, reports, controls, scenario). Use before claiming such a change is done.
---

# Verify books — three layers, all must agree

Inherited from the belifi rule: "two layers passing while the third disagrees has happened before".

| Layer | Command | Proves |
|---|---|---|
| 1. Unit/DB | `npm test` | Invariants: posting guards, parsers, continuity, matcher, rules, AI parsing/caching, PPN split, TB/FS, elimination, controls, close |
| 2. Ground truth | `npm run demo:reset && npm run verify:books` | ~1,000 balances: app TB per entity per month = independent recomputation from generator truth |
| 3. Product | `npm run build && npm run test:e2e` + look at `/clients/<id>/close` | Real UI: controls PASS except planted REVIEWs; investor walk ends with a locked period |

## Rules
- Paste real output tails into the cycle doc's Verification — never a remembered or predicted result.
- A layer-2 failure names entity, month, account, expected vs actual. Diff the first failing month; the bug is usually
  a sign convention, a PPN split, or a transfer pairing.
- Don't "fix" verify.ts to match the app. If the truth model is wrong, fix it in the same commit and say why.
- A REVIEW control is not a failure; a FAIL is. Balance-sheet difference must be exactly 0.

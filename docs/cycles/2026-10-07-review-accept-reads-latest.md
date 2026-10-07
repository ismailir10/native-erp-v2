# Review saves the account picked last, never a stale one

## Context
`e2e/leases.spec.ts` failed once locally (2026-10-07, usability pass), then passed 20 times in a row. The register was 10 jt off the
ledger: one of three rent payments did not land on 2170.

In Review, *Simpan* (`accept`) and *Terima serupa* (`acceptSimilar`) read the choice from the render the click handler belongs to
(`get(i)` over `choice`, a memo of the draft store). If the click lands before React re-renders after a pick, the save uses the previous
value: the suggestion (6120 Beban Sewa) instead of the 2170 just chosen. A person rarely clicks that fast, but a busy page or a slow
phone can, and the result is a wrong posting that looks accepted.

Stage: **Pembukuan**.

## Spec
- [x] Both saves read the draft store at the moment of the click (`latest(i)` = `readDrafts()[i.id] ?? suggestion(i)`); the render-time
  `get(i)` stays for display.

**Non-goals:** any change to what is saved or how.

## Tasks
- [x] T1 The change and gates. The existing Review e2e specs cover the flows (leases, review safety, accountant hints, tax split,
  investor walk).

## Implementation
- `components/app/review-queue.tsx`: `latest(i)`, used by `accept` and `acceptSimilar`.

## Verification
- `npm run lint` exit 0; `npm run typecheck` exit 0; `npm run build` exit 0.
- `e2e/leases.spec.ts` with the other Review specs, 3 repeats on 3 workers: leases 3/3.
  - The investor walk and review safety pass on their first run each.
  - Their repeats fail by design: they consume the shared seeded demo (August closed, its lines accepted).
- Full `npm run test:e2e` on a fresh seed: 54 passed (5.1m).
- The original failure could not be reproduced on demand, so this removes the one path known to produce it rather than proving it was
  that path.
## Ship Notes
- No migration. Rollback: revert.

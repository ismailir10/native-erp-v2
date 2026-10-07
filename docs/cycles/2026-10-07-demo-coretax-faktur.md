# The demo shows the ekualisasi PPN

## Context
I5c (ekualisasi PPN) is invisible in the demo: no demo company has Coretax faktur, so the card says "belum ada faktur" and a prospect
never sees the books tie to Coretax. The demo should show it working and, in August, waiting on Review.

Stage: demo (`lib/demo`).

## Spec
- [x] `demoFaktur(sc)` (pure): one faktur per taxed bank line of the scenario.
  - Keluaran (APPROVED) for receipts tagged PPN keluaran; masukan (CREDITED) for purchases tagged PPN masukan.
  - DPP and PPN as the books split them (rule 8).
  - Deterministic numbers; the counterparty is the bank text's key.
  - The August lines left open for the walk (the DP and the machine) have their faktur too.
- [x] The seed stores them right after the openings. They are evidence only: `verify:books` is unchanged, and every closed month ties.
- [x] The investor walk opens Pajak Masa after Review: keluaran and masukan *Lolos*. The script gets a short optional step.

**Non-goals:** demo bukti potong (the scenario withholds nothing at the PT level).

**Gate-reopeners:** none (no migration; demo data only).

## Tasks
- [x] T1 Generator, seed, demo test, investor walk step, script and demo-data skill.

## Verification
- `npm run demo:reset && npm run verify:books` → ALL PASS (1765).
- `tests/db/demo.test.ts`:
  - every PT month March–July ties both ways;
  - August keluaran lacks only the DP faktur, and masukan only the machine's;
  - no book PPN is without a faktur.
- `e2e/investor-demo.spec.ts` passes with the Pajak Masa step: both *Lolos* after Review.

## Ship Notes
- No migration. A `demo:reset` on an environment with `DEMO_MODE` brings the faktur in; production real data is untouched.

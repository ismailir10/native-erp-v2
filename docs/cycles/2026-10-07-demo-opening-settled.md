# Demo: the opening piutang and utang settle in March

## Context
Reading the demo Neraca as an accountant: Grup Ayam's *Piutang usaha* Rp 420 jt and *Utang usaha* Rp 240 jt sat unchanged from the
28 February opening through August. The scenario books sales and purchases on a cash basis, so nothing ever collected or paid them. A
reviewer would ask why six months passed without a customer paying. Synthetic data that looks wrong to an accountant undercuts the walk.

## Spec
- [x] March 2026: two customer receipts clear the opening piutang (CV Sumber Pangan Nusantara Rp 250 jt to BCA, UD Rizki Poultry
  Rp 170 jt to Mandiri, truth 1130), and one supplier payment clears the opening utang (PT Sinar Obat Hewan Rp 240 jt from BCA, truth
  2110). Fixed descriptions and amounts (no `rand()`), so every other scenario amount is unchanged; no seeded rule matches them, so they
  go through Review in the seed like any new counterparty.

**Non-goals:** accrual-basis demo sales (the invoice subledger is shown with its own e2e clients).
**Gate-reopeners:** none.

## Tasks
- [x] T1 Scenario lines — accept: `demo:reset` + `verify:books` ALL PASS; 1130 and 2110 nil at August; demo DB test and the
  demo-dependent e2e (investor walk, access, statement mismatch) pass.

## Verification
- `demo:reset` + `verify:books` ALL PASS (1765). PT Ayam Nusantara: 1130 = 0, 2110 = 0, BCA Giro Rp 2.342.157.217, Mandiri Giro
  Rp 456.300.000 at August. `tests/db/demo.test.ts` passes; `investor-demo`, `qa-access`, `statement-mismatch` e2e pass.

## Ship Notes
- Demo data only (run `npm run demo:reset` where the demo is used). Rollback: revert.

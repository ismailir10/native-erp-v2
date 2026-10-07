# Demo: rent paid net of PPh 4(2)

## Context
Buku's Review hint says *"Sewa tanah atau bangunan oleh badan usaha dipotong PPh 4(2) final 10%"*. The demo broke that rule:
PT Ayam paid its warehouse rent (Rp 45 jt) and CV Sinar its shop rent (Rp 12,5 jt) gross. Pajak Masa showed PPh 4(2) as nihil every month,
and *Dipotong oleh perusahaan* had nothing to make a bukti potong for. An Indonesian accountant would flag this as a compliance gap in the
very data used to sell the product.

## Spec
- [x] Rent truths withhold PPh 4(2) 10% (`rent(cash)`: gross = cash ÷ 90%). PT Ayam: Rp 45 jt net = Rp 50 jt gross, Rp 5 jt withheld.
  CV Sinar's rent is now Rp 13,5 jt net (Rp 1,5 jt withheld), so the gross is whole Rupiah.
- [x] A monthly *Setoran PPh 4(2)* on the 11th, sized by `remitTaxes` to the previous masa's withholding (CV Sinar now goes through
  `remitTaxes` too). February's withholding is in the openings (2145), so March's remittance pays it.
- [x] demo-data skill notes it.

**Non-goals:** PT Jasa Kreatif's co-working space (a service contract, not building rent).
**Gate-reopeners:** none.

## Tasks
- [x] T1 Scenario — accept: `demo:reset` + `verify:books` ALL PASS; demo Pajak Masa August: PT Ayam PPh 4(2) Rp 5.000.000 owed,
  July *Lunas*; CV Sinar Rp 1.500.000, July *Lunas*; the masa controls PASS; the demo tests and demo e2e pass.

## Verification
- `demo:reset` + `verify:books` ALL PASS (1765). Pajak Masa August (now = 1 Sep): PT Ayam PPh 4(2), 22 & 26 owed Rp 5.000.000, July
  Rp 5.000.000 *Lunas*, balance Rp 5.000.000, PASS, and the rent listed under *Dipotong oleh perusahaan*. CV Sinar Rp 1.500.000, the same.
  *Pajak masa disetor* PASS for all three companies.
- `tests/db/demo.test.ts`, golden, settings, workspace-access pass; e2e `investor-demo`, `qa-access`, `statement-mismatch` pass.

## Ship Notes
- Demo data only (`npm run demo:reset`). Rollback: revert.

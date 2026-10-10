---
name: demo-data
description: How Buku's synthetic demo data is generated, seeded through the real pipeline, verified against ground truth and walked by the investor e2e. Load before touching lib/demo, scripts/seed.ts, the investor script or e2e.
---

# Demo data

**Synthetic only.** Real client statements (chickin, belifi…) never enter git, fixtures or seeds (NDA + UU PDP).
Shapes are modelled on them; names, numbers and account numbers are invented.

## Pieces
- `lib/demo/scenario.ts` — deterministic (`mulberry32(20260924)`) scenario: 3 clients × Mar–Aug 2026.
  Every `DemoLine` has its **truth** (account + tax tag), optional simulated **AI answer** (may be wrong on purpose),
  and `open` = left in the review queue. A guard throws if any bank balance would go negative.
- `lib/demo/writers.ts` — renders statements in the formats the parsers read (BCA CSV, Mandiri XLSX, BRI CSV).
- `lib/demo/seed.ts` — truncates, creates firm/clients/COA/rules, posts openings, then **imports every file through
  `importStatement()`** month by month; reviews non-open lines with truth (trains Memory → AI calls fall to 0 after
  month 1); posts monthly depreciation through Grup Ayam's adjustment schedule (Rp 9,5 jt × 120 from Mar 2026); locks months ≤ `closedThrough`. Pre-caches AI answers for the live file.
- `lib/demo/verify.ts` — recomputes every entity's TB at every month-end from truth, compares to the app.
- `public/demo/<file>` — the held-back statement for the live upload (written by `npm run demo:reset`).

## The planted story (August 2026)
- **Grup Ayam Nusantara** (PT + owner Budi): owner's BRI Simpedes August file is held back → controls show
  BRI recon REVIEW, 1199 open, 1190 residual Rp 31 jt. Uploading it clears 1199 and the intercompany residual; BRI reconciliation and completeness remain REVIEW because the CMS export does not declare full-month coverage or an independent opening. 4 + 1 lines to review,
  one where AI is wrong (machine → should be 1210 Aset Tetap). August depreciation installment (6/120) proposed, not yet posted (one-click moment); after the machine is reviewed to 1210 it is a fixed-asset candidate for a new schedule.
- **Taxes are tidy**: payroll is paid net with PPh 21 (5 % of gross) withheld to 2140, and every PPN / PPh 21 remittance pays exactly what the
  previous masa owed (`remitTaxes`; the March ones pay the opening 2130 / 2140), so Pajak Masa is *Lolos* on every PT month.
- **Coretax faktur** (`lib/demo/faktur.ts`, evidence only): one per taxed line, with the PPN the books split from it, so the ekualisasi
  ties every closed month; in August the DP and the machine wait on Review, and tie once the walk decides them.
- Every month is a tidy client's: tax remittances pay exactly what the previous masa left owed (`remitTaxes`: PPN, PPh 21 withheld
  from payroll, PPh 4(2) 10% withheld from building rent by PT Ayam and CV Sinar), PT Ayam pays its PPh 25 angsuran (Rp 25 jt, seeded
  from January) by the 14th, and the opening piutang / utang settle in March.
- **CV Sinar Retail**: 2 lines to review. **PT Jasa Kreatif Digital**: fully closed.

## Changing it
1. Edit the scenario; keep it deterministic (only use `rand()`-based helpers, don't reorder calls casually — it shifts every amount).
2. `npm run demo:reset && npm run verify:books` → ALL PASS. `npm test` (tests/db/demo.test.ts checks the same + live upload).
3. If the walk changed: update `docs/demo/investor-demo.md` **and** `e2e/investor-demo.spec.ts`, then `npm run build && npm run test:e2e`.

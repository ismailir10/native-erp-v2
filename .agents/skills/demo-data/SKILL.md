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
  month 1); posts monthly depreciation; locks months ≤ `closedThrough`. Pre-caches AI answers for the live file.
- `lib/demo/verify.ts` — recomputes every entity's TB at every month-end from truth, compares to the app.
- `public/demo/<file>` — the held-back statement for the live upload (written by `npm run demo:reset`).

## The planted story (August 2026)
- **Grup Ayam Nusantara** (PT + owner Budi): owner's BRI Simpedes August file is held back → controls show
  BRI recon REVIEW, 1199 open, 1190 residual Rp 31 jt. Uploading it clears all three. 4 + 1 lines to review,
  one where AI is wrong (machine → should be 1210 Aset Tetap). August depreciation not yet booked (adjusting JE moment).
- **CV Sinar Retail**: 2 lines to review. **PT Jasa Kreatif Digital**: fully closed.

## Changing it
1. Edit the scenario; keep it deterministic (only use `rand()`-based helpers, don't reorder calls casually — it shifts every amount).
2. `npm run demo:reset && npm run verify:books` → ALL PASS. `npm test` (tests/db/demo.test.ts checks the same + live upload).
3. If the walk changed: update `docs/demo/investor-demo.md` **and** `e2e/investor-demo.spec.ts`, then `npm run build && npm run test:e2e`.

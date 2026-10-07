# Usability pass as an Indonesian accountant, and production as the only hosted environment

## Context
The owner asked for "a really hard usability test", seen as an Indonesian accountant would see it (2026-10-06), after I4c, I1d, I5b
and I2a shipped. Mid-pass they also asked to "just use production and treat it as the only" environment (2026-10-07). They chose
*production only, plus a local test stack* ([ADR 0015](../adrs/0015-production-only.md)).

Method: a scripted sweep (`e2e/ux-sweep.spec.ts`) opened every firm and client route at 1440 px and 390 px on the seeded demo. It
recorded:
- HTTP errors and console errors;
- horizontal page overflow and inner scroll at phone width;
- the number of `NextStep` banners;
- English or placeholder text;
- broken links.

The screenshots were then read as an accountant closing August 2026 for Grup Ayam would read them.

Stage: across all three (**Sumber**, **Pembukuan**, **Laporan**).

## Spec
- [x] **Pajak Masa reads like a tax card**:
  - the column is *Terutang masa ini*;
  - *Masa lalu* shows what was paid (*disetor*);
  - a payroll payment with no accrual says *disetor tanpa terutang*;
  - the status column moves under the name on phones.
- [x] **Petunjuk akuntan in Review** (`lib/classify/hints.ts`, deterministic, never applied on its own). These are checks a reviewer
  makes before accepting a line, each with a one-click fill:
  - a customer down payment coded to revenue goes to 2160 *Pendapatan Diterima di Muka* (PSAK 72);
  - a machine, vehicle or building ≥ Rp 5 jt coded to expense goes to 1210 *Aset Tetap*;
  - rent paid by a company with no withholding: PPh 4(2) 10 % for land or a building, PPh 23 2 % for a vehicle or equipment;
  - services paid by a company with no withholding: PPh 23 2 %.

  *Terima semua yang yakin* skips hinted lines and says how many are left to check one by one.
- [x] **Data request carries the upload link**: *Sisipkan tautan unggah* on the import page creates a 14-day link and puts it in
  the WhatsApp/email message (when evidence storage is on).
- [x] **Combined Laporan Keuangan** says the management report, its note and the bank credit pack are made per company.
- [x] **Sweep tooling**: `npm run ux:sweep` (skipped by `test:e2e` unless `UX_SWEEP=1`) writes `findings.json` and screenshots to
  `UX_OUT`.
- [x] **Production only** (ADR 0015):
  - `npm run auth:local` boots the local Supabase stack and writes its URL and keys into `.env`;
  - README, AGENTS.md, the ship skill, `.env.example`, `docs/real-data.md` and ADRs 0008/0010/0011 no longer send anyone to staging.

**Non-goals:**
- making the demo's tax payments coherent (its PPN and PPh 21 payments are random, so Pajak Masa shows *Perlu dicek* for the demo
  PKP companies);
- a Pajak Masa close control.

**Gate-reopeners:** none (no migration, no dependency).

## Tasks
- [x] T1 Usability fixes, accountant hints, the upload link in the request, with `tests/unit/review-hints.test.ts` and
  `e2e/accountant-hints.spec.ts`.
- [x] T2 The sweep as a script (`e2e/ux-sweep.spec.ts`, `npm run ux:sweep`).
- [x] T3 ADR 0015, `scripts/local-auth.sh` and the docs.
- [x] T4 Gates, including the full e2e on the local stack.

## Implementation
- T1:
  - `app/(app)/clients/[id]/tax/masa/page.tsx`;
  - `lib/classify/hints.ts`;
  - `components/app/review-queue.tsx`: hints under the line (`data-testid="review-hints"`); bulk accept keeps hinted lines out;
  - the review page passes `entityKind`;
  - `components/app/data-request-card.tsx` with `createUploadLinkAction`;
  - the import page;
  - the combined-reports note.

  Hint false positives found while testing were fixed: "SEWA MOBIL" is not a vehicle purchase, and "MESIN … TEKNIK" is goods, not a
  service. HPP (*pokok*) accounts get no service hint.
- T2: `e2e/ux-sweep.spec.ts`, `playwright.config.ts` `testIgnore`, and the `ux:sweep` script.
- T3: `docs/adrs/0015-production-only.md`, `scripts/local-auth.sh` (Docker check, `supabase start` without the unused services,
  `.env` update) and the `auth:local` script.

## Verification
- Sweep: no HTTP 5xx, no console errors and no page overflow at 390 px after the fixes.
- `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 178 passed (178), Tests 1159 passed (1159); `npm run build` exit 0;
  `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`; `npm run test:e2e` on the local stack: 51
  passed (4.7m).

## Ship Notes
- No migration, no env var. The owner may pause or delete the `native-erp-v2-staging` Supabase project and the Vercel Preview env.
- Rollback: revert.

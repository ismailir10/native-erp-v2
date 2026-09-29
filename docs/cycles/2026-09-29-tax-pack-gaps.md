# Paket Pajak Badan, lanjutan — kompensasi kerugian, kategori koreksi, kertas kerja Excel

## Context
Benchmark against Balancio's *Kalkulator PPh Badan* (balancioindo.com, the firm of Indra Firdaus, the accountant who advises Syaukani):
it has a 5-year **kompensasi kerugian** sheet, an auto-tagger of **koreksi fiskal** by category with a **partial %**, and an **Excel
kertas kerja** (Rekonsiliasi Fiskal / Pemetaan Akun / Kompensasi Kerugian). Our pack (cycle 2026-09-29-tax-pack) already goes further
(journals, deferred tax, PP 55, the ledger as source) but called loss carry-forward a non-goal and has no workpaper to hand to a partner.
Approved by the user as the first of five Balancio-gap cycles ("all in that order").

## Spec
- [ ] **Kompensasi kerugian (UU PPh Pasal 6 ayat 2):** per entity-year the accountant records the **remaining loss per origin year as of 1
      January** (from the prior SPT), 5 origin years back at most. The pack uses them **oldest first**, only those not expired (origin year
      + 5 ≥ the tax year), up to the fiscal profit before compensation; PKP = fiscal profit − compensation, rounded down to thousands. The
      statement shows each origin year's opening, used and remaining balance and the year it expires. The fiscal loss Buku computed for the
      previous year (its December pack, when that year has books) is **suggested** as an origin-year row; the accountant confirms it.
- [ ] **Correction categories with a partial %:** the suggestions become categories, each matched by account-name words, with a direction,
      a kind and a default %: *entertainment / jamuan / representasi* (+, tetap, 100 %), *sumbangan / donasi* (+, tetap, 100 %), *sanksi /
      denda / bunga penagihan* (+, tetap, 100 %), *natura / kenikmatan* (+, tetap, 100 %), *PPh / pajak penghasilan dibebankan* on an expense
      account (+, tetap, 100 %), *telepon seluler / kendaraan dinas* (+, tetap, **50 %**, KEP-220/PJ/2002), *cadangan / penyisihan / CKPN* (+,
      waktu, 100 %), *imbalan kerja / pesangon* accrual (+, waktu, 100 %). Accepting one stores its category and %; the accountant can change
      the % (1–100). The correction follows its account's year-to-date balance × %.
- [ ] **Kertas kerja Excel:** *Unduh kertas kerja* on the Pajak Badan page downloads an .xlsx built from the same pack (never a second
      computation): sheets **Rekonsiliasi Fiskal** (the statement, with sources), **Koreksi Fiskal** (each correction: description, category,
      kind, direction, %, account, amount), **Laba Rugi** (every P&L account year to date, the start of the reconciliation), **Kompensasi
      Kerugian**, **Kredit Pajak** (PPh 25 lines with date and bank row, bukti potong), **Pajak Tangguhan** and **Jurnal** (postings made and
      the difference still proposed). Header on each sheet: firm, client, entity, NPWP, year, "s.d." month, *estimasi — bukan SPT*, generated at.
      Tenant-checked route; IDR amounts as Excel numbers (safe below 2⁵³, else text).

**Gate-reopeners (flagged):** schema migration (TaxLossCarryforward per entity-year: origin year, amount; FiscalCorrection gains `category`
and `percent` 1–100 with CHECKs); accounting rule 5d amended. No dependency (ExcelJS is already used), no AI.

**Non-goals:** SPT 1771 layout; carrying forward losses *computed* by Buku across several years automatically (only last year's is suggested);
DER / thin-cap limits; PPh 24 credit limit; PDF export.

**Assumptions:**
1. The loss balance typed for an origin year is what remained unused at 1 January of the tax year (as on the prior SPT's lampiran).
2. The 50 % for mobile phones and service vehicles follows KEP-220/PJ/2002; the accountant can set another %.
3. The workpaper reflects the page's selected month (year to date), like the page.

## Tasks
- [x] T1 Schema: migration `tax_losses_categories` — accept: `migrate diff` empty; gate green.
- [x] T2 Carry-forward + categories in the pack (`lib/tax/categories.ts`, `lib/tax/pack.ts`, `lib/tax/records.ts`) — accept: unit tests (oldest
      first, expiry, partial use, loss year) and DB tests (categories with %, live amount × %, last year's loss suggested).
- [x] T3 Workpaper: `lib/tax/workpaper.ts` + route — accept: unit test reads the generated .xlsx back (sheet names, key figures equal the pack).
- [ ] T4 UI: loss rows, category + % on corrections, *Unduh kertas kerja* — accept: e2e extends `e2e/tax-pack.spec.ts` (loss used, % changed,
      download parsed), screenshots 1440 / 390.
- [ ] T5 Rules + docs — accept: end-of-cycle gates.

## Implementation
- Plan: T1–T5 sequential, inline. Scope approved with the five-cycle plan ("all in that order").
- T1: `prisma/schema.prisma`, migration `20260929030000_tax_losses_categories` (TaxLossCarryforward, FiscalCorrection.category/percent, CHECKs).
- T2: `lib/tax/categories.ts` (8 categories, `share`, `compensate`), `lib/tax/pack.ts` (category suggestions with default % and the corrected share; accepted ones follow account × %; compensation before PKP; last year's December fiscal loss suggested, the prior pack computed once without its own suggestion), `lib/tax/records.ts` (`acceptSuggestion` with %, `setCorrectionPercent`, `setLoss`/`deleteLoss`, `dismissSuggestion` also for `loss:YYYY`), tests `tests/unit/tax-categories.test.ts`, `tests/db/tax-records.test.ts`, `tests/db/tax-pack.test.ts`.
- T3: `lib/tax/workpaper.ts` (7 sheets from the pack; the pack now exposes `profitAndLoss` so the Laba Rugi sheet reads the same statement), route `app/(app)/clients/[id]/tax/export/route.ts` (tenant-checked, `no-store`), `tests/db/tax-workpaper.test.ts` (generated file read back: sheet names, PBT, compensation, PKP, tax, PPh 29, the 50% correction, the posted journal lines).

## Verification
## Ship Notes

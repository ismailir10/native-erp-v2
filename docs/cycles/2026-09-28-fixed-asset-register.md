# Aset Tetap — daftar aset, penyusutan PSAK 16, penyusutan fiskal, pelepasan

## Context
Feedback 2026-09-28 (Syaukani, accountant): "tambahin beberapa perhitungan penerapan PSAK … perhitungan tax, depresiasi dsb".
Buku already posts depreciation as an **adjustment schedule** (rule 5a: a straight-line split proposed each month, posted by a click),
but an accountant thinks in **assets**, not schedules: *Daftar Aset Tetap* (asset, group, acquisition date, cost, accumulated
depreciation, book value) is a standard note to the financial statements (PSAK 16 / SAK EP), and the tax return needs the **fiscal**
depreciation per asset group (UU PPh Pasal 11, PMK 72/2023) to compute the fiscal correction (koreksi fiskal). Selling or scrapping
an asset has no flow today: the accountant types the derecognition journal by hand and computes the gain or loss.

Outcome: a fixed-asset register per entity that (1) creates each asset's book depreciation schedule, (2) shows book vs fiscal
depreciation and the difference the tax cycle will use, (3) disposes an asset with one explicit entry, and (4) is checked against
the ledger at close. Deterministic; no AI.

## Spec
Register (`lib/assets/`, new; `FixedAsset` model)
- [ ] An asset belongs to one entity: name, **fiscal group** (Kelompok 1–4, Bangunan permanen, Bangunan tidak permanen, Tanah),
      fiscal method (garis lurus / saldo menurun; buildings straight line only, land none), acquisition date, cost, residual value
      (default 0), book useful life in months (default from the group: 48 / 96 / 192 / 240 / 240 / 120; land none), asset account
      (ASET_TETAP), and — except land — a book depreciation schedule (expense account, accumulated-depreciation account, start month;
      default the month after acquisition).
- [ ] **Creating an asset creates its schedule in the same transaction** through the existing schedule code (rule 5a unchanged:
      exact straight-line installments of cost − residual − opening accumulated, proposed monthly, posted by a click). Three ways in:
      from a **purchase line** in the ledger (a debit on an ASET_TETAP account not cited by a schedule or asset: source entry + line kept,
      rule 15), **from an existing depreciation schedule** (links it; no new schedule), or **by hand** for assets in Saldo Awal
      (with accumulated depreciation at the opening date; the schedule spreads the remaining book value over the remaining life).
- [ ] **Register at a period end** (per entity, and per asset): cost, accumulated book depreciation (opening accumulated + the
      schedule's posted installments to that date — read from the GL, never stored), book value, book depreciation this year (posted),
      **fiscal depreciation this year** (estimate, computed), and the **difference** book − fiscal ("koreksi fiskal", positive = add
      back). Installments due but not posted are shown as such (link to Jurnal Penyesuaian). Disposed assets drop out after their month.
- [ ] **Fiscal depreciation** (`lib/assets/fiscal.ts`, pure, bigint): starts in the month of acquisition; straight line = the group's rate on the cost each year; declining balance = the group's rate (50 / 25 / 12,5 / 10 %) on the fiscal book
      value at the start of each year, the first year pro rata by months, and the remaining value taken in full in the year the life
      ends; buildings 5 % / 10 % straight line; land none. Rounded half-up per asset per year. Labelled **estimasi fiskal** — a figure
      for the tax computation, never posted. Shown for IDR entities only.
- [ ] **Pelepasan (disposal)** of an asset at a date with proceeds (≥ 0) to a chosen non-bank account (default 1140 Piutang
      Lain-lain; the bank receipt is classified to the same account): refused while an installment due through that month is unposted
      or the month is locked. One `ADJUSTMENT` entry through `postJournal()`: Dr accumulated depreciation (to date), Dr proceeds account,
      Cr asset (cost), and the gain (Cr) or loss (Dr) on **7300 Laba/Rugi Pelepasan Aset Tetap**. The schedule stops; the asset keeps
      `disposalEntryId` (the drill from the entry to the asset and back). 7300 joins the COA template; an existing client gets it on its
      first disposal if the code is free (else the accountant picks the account).
- [ ] **Close control** `fa:<entity>` (only when the entity has registered assets): register cost vs the GL balance of the asset
      accounts the register uses, register accumulated vs the GL balance of their accumulated-depreciation accounts, at the period
      end. Equal = PASS; different = **REVIEW** with both figures (assets not yet registered or typed journals explain it; a note acks it).
- [ ] **UI:** *Aset Tetap* page under Akuntansi (ScopeBar period + entity): NextStep, the register with totals and the GL comparison,
      *Pembelian aset belum terdaftar* (Daftarkan → prefilled form), *Jadwal penyusutan tanpa aset* (Jadikan aset), *Tambah aset*, and
      per asset *Lepas aset*. The fiscal columns carry the estimate label. Works at 390 px (secondary columns hidden).
- [ ] **Demo:** the demo seed registers Grup Ayam's existing depreciation schedule as an asset (no GL change: `verify:books` ALL PASS
      with the same numbers).

**Gate-reopeners (flagged):** schema migration (new `FixedAsset`, enums `AssetTaxGroup` + `FiscalMethod`, CHECKs `cost > 0`,
`0 ≤ residual < cost`, `openingAccumulated ≥ 0`); a new accounting rule **5b** in `accounting-rules` (register, fiscal estimate, disposal);
COA template gains 7300. No new dependency, no AI.

**Non-goals:** book declining-balance or units-of-production methods (straight line only for the books); revaluation model and
impairment (PSAK 16 revaluation / PSAK 48); partial disposals; componentisation; the tax return itself (the fiscal-correction total
feeds the tax cycle); intangible assets (1250) — same mechanics later; leases (PSAK 73).

**Assumptions:**
1. Book depreciation stays straight line through `AdjustmentSchedule` (rule 5a): one asset ↔ at most one schedule.
2. The month of disposal is depreciated in full (all installments through that month must be posted first).
3. Fiscal depreciation starts in the acquisition month and is computed from the acquisition date even for assets that came in
   through Saldo Awal; the book side uses the opening accumulated depreciation the accountant types.
4. One asset per purchase line (several assets on one invoice line are registered by hand without a source line).
5. Proceeds are recorded against a non-bank account; the bank receipt is classified to the same account (bank lines are only changed
   through review, rule 3).
6. Rates per PMK 72/2023: Kelompok 1 4 th (25 % / 50 %), 2 8 th (12,5 % / 25 %), 3 16 th (6,25 % / 12,5 %), 4 20 th (5 % / 10 %);
   bangunan permanen 20 th 5 %, tidak permanen 10 th 10 %.

## Tasks
- [x] T1 Schema + fiscal math: migration `fixed_assets` (model, enums, CHECKs), 7300 in the COA template, `lib/assets/fiscal.ts` —
      accept: unit tests with worked examples (Kelompok 1 saldo menurun from July, Kelompok 2 garis lurus, bangunan, tanah, year the
      life ends, pro rata first year); `prisma migrate diff` empty; gate green.
- [x] T2 Register core: `lib/assets/register.ts` — `createAsset` (source line / existing schedule / by hand, schedule in the same
      transaction, reuse `createSchedule` checks), `assetRegister(period, entity)`, `assetCandidates` — accept: DB tests for the three
      ways in, GL-derived accumulated depreciation, due-but-unposted, candidates disappearing once registered. Depends T1.
- [x] T3 Disposal: `disposeAsset` — accept: DB tests for gain, loss, zero proceeds, land, refusal with unposted installments,
      locked month, 7300 created once / picker when the code is taken; the schedule stops. Depends T2.
- [ ] T4 Close control `fa:` in `runControls` — accept: DB test PASS when equal, REVIEW with both figures when a typed journal moves 1210.
      Depends T2.
- [ ] T5 UI: `app/(app)/clients/[id]/assets/page.tsx`, components, actions, sidebar — accept: e2e walk on a fresh client (Saldo Awal
      asset by hand → register → post depreciation → dispose with a gain → register and control), screenshot checked at 1440 and 390 px.
      Depends T2–T4.
- [ ] T6 Demo + rules + docs: seed registers Grup Ayam's schedule as an asset; `accounting-rules` rule 5b; README — accept: end-of-cycle
      gates (build, `verify:books` ALL PASS, full e2e). Depends T5.

## Implementation
- Plan: T1–T6 sequential, inline (each layer uses the one before; the invariants need one driver).
- T1: `prisma/schema.prisma`, `prisma/migrations/20260928160000_fixed_assets` (FixedAsset, AssetTaxGroup, FiscalMethod; CHECKs cost > 0, 0 ≤ residual < cost, 0 ≤ opening accumulated ≤ cost − residual, life 1–600, disposal recorded whole), `lib/assets/fiscal.ts`, `lib/coa/template.ts` (7300 + `ACCOUNT_CODES.DISPOSAL_GAIN_LOSS`), `tests/unit/fiscal-depreciation.test.ts`.- T2: `lib/assets/register.ts` (`createAsset` three ways in, `assetRegister`, `registerVsLedger`, `assetCandidates`, `unregisteredSchedules`), `lib/adjust/schedules.ts` (`amountMinor`, `inTx` hook, `owed` exported), migration `20260928161000_fixed_asset_accumulated_account` (found while testing: a fully depreciated Saldo Awal asset has no schedule, so the asset keeps its accumulated-depreciation account; CHECK land ⇔ none), `tests/db/assets.test.ts`. Fiscal straight line changed to a yearly amount (rate × cost, pro rata, half-up; last year the rest), spread by month inside the year — a full year is exactly 12,5 % of cost, not twelve rounded months.
- T3: `lib/assets/dispose.ts`, `tests/db/asset-disposal.test.ts` — the schedule row is locked while the posted total is read (serialised with an installment click); "posted after the disposal" compares months (installments are dated the month's last day); 7300 is used only when its name says *pelepasan aset*, created on the first disposal when the code is free, otherwise the accountant picks a P&L account.

## Verification
- T1: `prisma migrate diff` DB ↔ schema empty. Gate: lint ✓ typecheck ✓ `Test Files 66 passed (66) · Tests 503 passed (503)`. Worked example (Kelompok 1 saldo menurun, Rp 100 jt from Jul 2024): 25 / 37,5 / 18,75 / 9,375 / 9,375 jt, Σ = cost.- T2 gate: lint ✓ typecheck ✓ `Test Files 67 passed (67) · Tests 507 passed (507)`.
- T3 gate: lint ✓ typecheck ✓ `Test Files 68 passed (68) · Tests 512 passed (512)`.

## Ship Notes

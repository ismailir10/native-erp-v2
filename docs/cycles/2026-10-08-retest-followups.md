# Retest follow-ups: a person's books have no cost of sales; payment fees and small assets

## Context
After shipping docs/cycles/2026-10-08-chickin-bank-e2e.md the three production test clients were deleted and the walk was redone from
**Tambah klien** with the same real files (Chickin GL/TB workbook; Belifi BCA June + SMBC May PDFs). Every earlier fix held in production:
owner transfer "… Belifi ALFI YANDRA" on 1190 (out of the bulk accept), customer receipts → 4100 with a sharper business description,
Chickin mapping (Internet → 6130, deferred tax → 1270, vehicle tax → 6190, biological assets → 1160, production cost → new HPP account,
right-of-use → 1230), the opening sheet reads with 0 blockers, entity reports render without the group's rates, balances tie to the
workbook GL (e.g. SKP BCA Rawasari Rp 27.210.777.768, APIC Rp 158.918.535.058).

Left for an accountant:

| # | Finding | Cause |
|---|---|---|
| 1 | The owner's (Perorangan) outgoing BI-FAST lines: AI → **5100 Pembelian Bahan & Barang Dagang** (40%), reason "bayar supplier barang dagang" | `aiScope` keeps cost-of-sales and selling-expense accounts on offer for a person |
| 2 | "Platform Fee - QRIS" → 6150 Beban Pemasaran (AI, 88%) | no rule for payment fees (QRIS/EDC MDR); the model reads "platform fee" as marketing |
| 3 | "Low Value Asset" → 6180 Beban Penyusutan (AI, 70%) | no rule; a small asset expensed at purchase is supplies, not depreciation |

## Spec
- [ ] For a PERORANGAN line the AI is not offered HPP or BEBAN_PENJUALAN accounts either (with the trade receivable / payable / sales lines
  already left out). The owner's outgoing line then answers among Prive, other expenses or a balance-sheet account.
- [ ] Mapping rules: QRIS / EDC / MDR / merchant discount / payment-gateway fees on an expense account → 7100 Beban Administrasi Bank
  (a payment fee); "low value asset" / "aset bernilai rendah" / "inventaris kecil" on an expense account → 6160 Beban Perlengkapan Kantor.

**Non-goals:** a different default for a person's unexplained incoming transfers; historical bulk close (proposed separately).

**Gate-reopeners:** none. A person's next import asks the model again for leftovers (new prompt); companies keep their cache.

**Assumptions:** 1. No personal books carry cost of sales or selling expenses. 2. Payment fees belong with bank charges (7100) in this chart.

## Tasks
- [x] T1 Person scope without HPP / selling expenses (`lib/ai/classify.ts`) — accept: `tests/db/ai-retry.test.ts` asserts 5100 / 6150 absent for a person, present for a PT.
- [ ] T2 Payment-fee and low-value-asset rules (`lib/ledger-import/mapping.ts`) — accept: `tests/db/mapping.test.ts` cases; prior expectations kept.

## Implementation
- Plan: T1, T2 sequential, inline (two small edits in different files).
- T1: `lib/ai/classify.ts` — `NOT_FOR_PERSON` adds HPP and BEBAN_PENJUALAN. Test: `tests/db/ai-retry.test.ts` (5100 / 5110 / 6150 absent for a person, present for a PT).
## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 184 passed (184), Tests 1210 passed (1210).
## Ship Notes

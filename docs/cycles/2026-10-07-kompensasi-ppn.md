# Kompensasi PPN: the masa-end journal

## Context
I read the demo's Laporan Keuangan notes as an accountant. *Pajak dibayar di muka* holds PPN Masukan Rp 455,9 jt and *Utang pajak*
holds PPN Keluaran Rp 543,8 jt, both grossed up since March. Every month an Indonesian accountant credits the masukan against the keluaran
(*jurnal kompensasi PPN*, Dr PPN Keluaran / Cr PPN Masukan). The balance sheet then shows only the net Utang PPN (here Rp 87,9 jt, August's
masa) or a lebih bayar carried forward. A reviewer would ask why the PPN accounts are gross, and the current ratio is off by both amounts.
Buku computed the masa net already but had no way to journal it.

## Spec
- [x] `masaReport` gives the PPN row `offset`: 1150's balance at the masa end less the lebih bayar carried out (negative =
  compensated too much). It gives `offsetLater` when a compensation is already dated after the masa, and then `offset` is 0, so an
  earlier masa never compensates twice.
- [x] `postPpnOffset` posts it by click: ADJUSTMENT dated the masa end, Dr 2130 / Cr 1150 (reversed for a negative), `sourceRef`
  `ppn-offset:YYYY-MM`, under an advisory lock with a stale-balance check. Months never compensated are caught up in the same entry.
- [x] The entry is neither keluaran, masukan nor setoran: the masa sums, the ekualisasi's book PPN and the client tax card skip it.
- [x] Pajak Masa: a line under PPN with the amount, the journal (Dr / Cr, date) and *Catat kompensasi*. When nothing else is open, a
  NextStep says so before the done state.
- [x] accounting-rules 5j and the README say so.

**Non-goals:** posting it automatically; restitusi; compensating inside the seed (the demo leaves it as a one-click moment).
**Gate-reopeners:** none (no schema change: `sourceRef` exists).

## Tasks
- [x] T1 Report, posting, exclusions, action, UI, docs, tests — accept: DB tests for the catch-up entry (figures and balance unchanged,
  no double posting, the reverse after a later correction), the lebih bayar case, the ekualisasi unchanged after it, and the tax card's
  setoran; e2e: two Review lines with PPN, the Pajak Masa line, one click, the ledger of 1150 shows it.

## Verification
- `npm test` 1184 passed; `npm run build`; `demo:reset` + `verify:books` ALL PASS (1765); `test:e2e` 56 passed (new `e2e/kompensasi-ppn.spec.ts`).
- UX sweep: no new findings. Demo Pajak Masa August: "PPN masukan belum dikompensasikan ke keluaran: Rp 455.870.720 (Dr 2130 / Cr 1150
  per 31 Agu 2026)" with *Catat kompensasi*; posting it leaves 2130 at the masa's Rp 87.890.991 and 1150 at nil.

## Ship Notes
- No migration. A new journal only when the accountant clicks it. Rollback: revert (posted compensations stay as ordinary adjustments;
  void them by reversing journal if wanted).

# Pajak Masa on a phone: the amount withheld stays in view; upload pickers reset

## Context
Read at 390 px after I5c/I5d:
- the *Bukti potong (Unifikasi)* table scrolled sideways, and *Dipotong*, the number that matters, sat past the edge (ui-rules 8);
- after an upload, the Coretax pickers kept showing the file name, which reads as a file still waiting.

## Spec
- [x] The withholding table hides Tanggal and Jenis below `sm`. Both move under the counterparty, so Lawan transaksi and Dipotong fill the
  phone width.
- [x] The faktur and bukti potong pickers empty after a successful upload (a new key on the input).

**Gate-reopeners:** none.

## Tasks
- [x] T1 Both, checked at 390 px with the e2e screenshot hook, plus the Pajak Masa e2e specs (bukti potong, ekualisasi, tax split).

## Verification
- `e2e/bukti-potong.spec.ts`, `e2e/ekualisasi-ppn.spec.ts`, `e2e/qa-tax-split.spec.ts`: 4 passed. At 390 px the row reads "JASA
  KONSULTAN HARAPAN · 21 Agu 2026 · PPh 23 · 300.000" and the picker shows no file after the upload.

## Ship Notes
- No migration. Rollback: revert.

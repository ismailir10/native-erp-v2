# Pajak masa in Tutup Buku

## Context
The usability pass ([2026-10-07-usability-pass](2026-10-07-usability-pass.md)) found that Tutup Buku checks the bank, the
suspense, the schedules and the subledgers, but not whether last month's taxes were paid. An Indonesian accountant closing a month checks
that first: a late PPh 21 or PPN payment brings a penalty (STP) and is the client's most common finding.

I4c already judges each masa (`lib/tax/masa-report.ts`, accounting-rules 5j). The demo now pays its taxes in full, so a control can go in
without new noise on the investor walk.

Stage: **Pembukuan** (close).

## Spec
- [x] Control `masa:<entity>` *Pajak masa disetor*, one per company. It is skipped for an individual, for a non-Rupiah book and for a company
  with no tax activity.
  - **REVIEW** when any tax row is REVIEW. The detail gives each flagged tax with its first note, e.g. "PPh 21: Masa Juli 2026: Rp 50.000
    dari Rp 200.000 belum disetor…".
  - **PASS** otherwise. The detail says the previous masa was paid in full, or that it is not yet due.
  - The link goes to Pajak Masa for that month and company.
- [x] A REVIEW is cleared by a note, as any control.
- [x] **PPh 21 leaves the Unifikasi list.** Payroll now carries PPh 21 withholding, so payroll lines appeared under *Bukti potong
  (Unifikasi)*. PPh 21 slips (BPMP / BP21) are made per recipient in e-Bupot 21/26, not in Unifikasi. The list and the Excel sheet now
  hold PPh 22, 23 and 4(2) only, and say where PPh 21 goes.
- [x] **Pajak Masa waits for Review.** On the demo, August read "lolos semua pemeriksaan … unduh untuk lapor di Coretax" while the DP
  (PPN keluaran) and the machine (PPN masukan) were still in Review on 1999. Filing from that would understate both. The banner now
  says how many of the month's lines are in Review, and links there.

**Non-goals:**
- blocking the close (FAIL);
- e-Bupot or Coretax status.

**Gate-reopeners:** none.

## Tasks
- [x] T1 The control in `lib/controls/index.ts`, accounting-rules 5j, and a DB test (absent, REVIEW when short, PASS once paid).
- [x] T2 PPh 21 out of the Unifikasi list (`masaReport` query, page, workbook) + the bukti-potong test asserts a payroll line is not
  listed.
- [x] T3 Pajak Masa is not called final while lines wait in Review: the banner counts the company's lines of the month still in
  Review ("4 mutasi … masih di Review, jadi pajak masa ini belum final", *Buka Review*) instead of "lolos semua pemeriksaan … untuk
  lapor". *Masa lalu* drops the "disetor" line when it equals the amount owed (ui-rules 9). E2e in `e2e/accountant-hints.spec.ts`.
- [x] T4 Laporan Keuangan tabs wrap on a phone: the strip scrolled sideways and hid CALK, Kertas Kerja Gabungan and Catatan manajemen
  past the screen edge (found by the sweep at 390 px).
- [x] T5 Gates.

## Implementation
- T1: `collectControls` runs `masaReport` per company after the tax pack. "Active" means owed, a balance or a previous masa with something
  owed or paid. Test: `tests/db/masa-report.test.ts` "Tutup Buku — Pajak masa disetor".

## Verification
- On the seeded demo for August 2026, *Pajak masa disetor* is PASS for PT Ayam Nusantara and PT Jasa Kreatif ("Masa Juli 2026 disetor penuh
  sampai jatuh tempo; saldo PPN, PPh 21 sesuai yang masih terutang"), and absent for CV Sinar (no tax activity) and the owner. The
  investor walk still has two flagged controls.
- `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 178 passed (178), Tests 1161 passed (1161); `npm run build`
  exit 0; `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- `npm run test:e2e` locally: 50 passed and 1 failed. The failure was `leases.spec.ts`: the register was 10 jt off the ledger, meaning
  one of three rent payments did not land on 2170. It did not reproduce in 20 repeats (5 serial, 15 on 3 workers). This change does not
  touch Review or leases, so it is recorded here rather than fixed; CI is the confirmation run.
- Final head (after T2–T4): `npm run test:e2e` 52 passed (5.1m); `npm test` 1161 passed.

## Ship Notes
- No migration. Real clients may see a new REVIEW on Tutup Buku where a masa was paid late or short: that is the point.
- Rollback: revert.

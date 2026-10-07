# Pajak Masa: PPN keluaran and masukan net of corrections

## Context
`masaReport` summed PPN keluaran as the month's **credits** on 2130 and masukan as the **debits** on 1150. A correction in Review or the
ledger (*Ubah akun*) posts a RECLASS of the difference: taking PPN keluaran off a receipt debits 2130, and taking PPN masukan off a
purchase credits 1150. The report ignored those lines. It kept the first posting's PPN as owed and then flagged the masa *Perlu dicek*,
because the account balance no longer matched. Accountants correct lines every month, so this was a false alarm on real work.

Found by reading the code against the ekualisasi (I5c), which already nets per source.

## Spec
- [x] Keluaran = Σ (credit − debit) on 2130 in the masa, remittances excluded (a debit with a bank credit in the same entry).
- [x] Masukan = Σ (debit − credit) on 1150 in the masa. A purchase's own bank credit is not a payment here.

**Gate-reopeners:** none.

## Tasks
- [x] T1 The fix and a DB test: a receipt booked with PPN keluaran then corrected, and a purchase with PPN masukan then corrected. The masa
  shows 0 / 0 and *Lolos*.

## Verification
- `tests/db/masa-report.test.ts` "nets a correction…" fails before the fix (keluaran 1.100, masukan 400) and passes after.
- The masa, faktur, demo and workspace DB tests all pass (29).

## Ship Notes
- No migration. Months where a PPN line was corrected now show the right keluaran / masukan. Rollback: revert.

# PPh 21 Desember: the Pasal 17 annual recompute

## Context
Pajak Masa checks PPh 21 against TER from January to November. For December it said only *"Masa Desember dihitung ulang dengan tarif
Pasal 17 untuk setahun; TER tidak dipakai, jadi tidak dicek di sini"*. But December is the month accountants find hardest. Every permanent
employee's PPh 21 for the year is recomputed under Pasal 17 (PMK 168/2023), the TER withheld January–November is subtracted, and the
difference is December's PPh 21, which goes on the 1721-A1. It is often negative (lebih potong, returned to the employee). Buku already
has what this needs: the census wage, the PTKP status and the TER tables.

## Spec
- [x] `lib/tax/ter.ts`: PTKP amounts (Rp 54 jt; + Rp 4,5 jt married; + Rp 4,5 jt per dependent, up to 3), Pasal 17 rates (UU HPP: 5 % to
  Rp 60 jt, 15 % to 250 jt, 25 % to 500 jt, 30 % to 5 M, 35 % above), and `pph21Annual`:
  - months worked in the year (from the hire month, in December's census);
  - bruto = census wage × months;
  - biaya jabatan = 5 %, at most Rp 500 rb a month;
  - PKP = neto − PTKP, rounded down to thousands, never below zero;
  - PPh setahun under Pasal 17;
  - TER January–November;
  - December = setahun − TER (negative = lebih potong).
- [x] `masaReport.ter` for December: state `ANNUAL` with each employee's lines. The estimate is the sum of December figures; compared with
  the PPh 21 booked as owed for December, within 10 % passes. Same states as before for no census and no PTKP status.
- [x] Pajak Masa *PPh 21 Desember (Pasal 17 setahun)* table and the Excel sheet carry the same columns.
- [x] Says what it leaves out: THR / bonus and the employee's JHT / JP iuran are not in the census, so this is an **estimate**, like TER.

**Non-goals:** employees who left during the year (their final computation is in the month they leave); non-residents / annualised
expatriates; NPWP-less surcharge (abolished for NIK holders).
**Gate-reopeners:** none.

## Tasks
- [x] T1 `ter.ts` annual computation + unit tests (DJP's TK/0 Rp 10 jt example: December Rp 800.000; a K/1 case; a mid-year hire; a
  lebih potong).
- [x] T2 `masaReport` December state, page, Excel, notes + DB test + e2e.

## Verification
- `tests/unit/tax-ter.test.ts`: Pasal 17 layers (0, 60 jt, 111 jt, 600 jt, 6 M); DJP's TK/0 Rp 10 jt → December Rp 800.000; K/1 Rp 15 jt →
  PKP 111 jt, PPh setahun 10,65 jt, TER 9,9 jt, December 750 rb; hired in July → 6 months, lebih potong Rp 850.000; under PTKP → nil.
- `tests/db/masa-report.test.ts`: December `ANNUAL` state, PASS against a December payroll withholding Rp 800.000, the note, the Excel
  sheet; a July hire turns the estimate into lebih potong Rp 50.000 and REVIEW. An employee who left in July is not in December.
- `e2e/pph21-december.spec.ts`: census with *Status PTKP* imported, Pajak Masa December shows the table, the lebih potong and *Perlu dicek*.

## Ship Notes

# I5d — Bukti potong Unifikasi: Coretax against the withholding in the books

## Context
The second half of ADR 0014 I5's Coretax item, after I5c (faktur vs PPN). Each month:
- the firm issues *bukti potong* (BPPU) in Coretax for what its client withheld from vendors (PPh 23, PPh 4(2), PPh 22);
- the client's customers issue bukti potong for what they withheld from it, a credit for the client's PPh Badan.

The books hold the same facts on the bank lines (`whtKind` + `whtAmount`, rule 5h); Pajak Masa lists them under *Bukti potong
(Unifikasi)*. Today nothing ties the two:
- a withholding with no bukti potong means a slip still to issue, or a credit still to chase;
- a bukti potong with no withholding in the books means a payment booked gross that was actually net, or the wrong masa.

Stage: **Laporan** (Pajak Masa).

## Spec
- [x] **Read a Coretax bukti potong export** (`lib/tax/bupot-read.ts`, pure, the faktur reader's pattern).
  - **Dibuat** (we withheld) is recognised by the recipient's columns (*NPWP/NIK/Nama Penerima Penghasilan*). **Diterima** (withheld from
    us) is recognised by the withholder's columns (*NPWP/Nama Pemotong*).
  - Required: *Nomor Bukti Potong*, a date (*Tanggal Pemotongan / Bukti Potong / Dokumen*), and the tax (*PPh Dipotong / Pajak
    Penghasilan / PPh*).
  - Optional: *DPP / Penghasilan Bruto*, *Kode Objek Pajak*, *Masa / Tahun*, *Status*.
  - The kind comes from the KOP (`24-…` PPh 23, `28-…` PPh 4(2), `22-…` PPh 22, `27-…` PPh 26). Without a KOP it comes from the
    *Jenis Pajak* words, else it is *lainnya*.
  - Cancelled (*dibatalkan / batal / cancel*), replaced (*diganti*), rejected and draft slips are kept, not counted. A *pembetulan* is the
    slip that replaces the earlier one, so it counts.
  - Every row keeps its `sheet!row`. A duplicate number is refused. Sen are rounded per slip.
- [x] **Store** (`CoretaxBupot`, migration). One per (entity, direction, number); a re-import updates it; audited (`BUKTI_POTONG`);
  *Hapus* per direction and masa; removed with the client.
- [x] **Reconcile per company and masa** (`lib/tax/bupot.ts`), per direction:
  - Counted slips' PPh against the books' withholding of the masa: **dibuat** = outgoing bank lines with PPh 23, 4(2) or 22 withheld;
    **diterima** = incoming lines with withholding. PPh 21 stays out (e-Bupot 21/26).
  - Matching is one to one on the exact PPh: NPWP first (a 16-digit NPWP is read as its 15-digit form), then a shared name word, then
    the nearest date.
  - A matched pair of different kinds (a slip says 4(2), the books say 23) is listed as *jenis berbeda*.
  - The matching is shared with I5c (`lib/tax/coretax-match.ts`).
- [x] **On Pajak Masa:**
  - the *Bukti potong (Unifikasi)* card gets *Cocokkan dengan Coretax*: upload, per direction slips vs books, and the unmatched both ways;
  - the banner names a gap;
  - the Excel *Bukti Potong* sheet gets the comparison when slips exist.
- [x] **Close control** `bupot:<entity>` *Bukti potong Coretax = buku* (REVIEW while either side differs). It appears only once slips for
  the masa are imported.

**Non-goals:**
- PPh 21 bukti potong (BPMP / BP21);
- creating bukti potong or a BPPU upload file for Coretax (ADR 0014: not a PJAP);
- adding a typed credit to the tax pack from a slip (rule 5d keeps credits typed by the accountant).

**Gate-reopeners:**
- one migration;
- no new dependency.

**Assumptions:**
1. Column names follow Coretax's *Daftar Bukti Potong* (BPPU) export. A real file decides further synonyms.
2. The masa of a withholding in the books is its bank date's month, as Pajak Masa already lists it.

## Tasks
- [x] T1 `lib/tax/coretax-match.ts` (shared from I5c, faktur moved onto it) + `lib/tax/bupot-read.ts` + unit tests:
  - dibuat and diterima detection;
  - kind by KOP and by words;
  - a cancelled slip;
  - the refusals.
- [x] T2 Migration, `lib/tax/bupot.ts` (import, delete, recon) and the control. DB tests:
  - a dibuat month with one slip matched, one withholding without a slip and one slip not booked;
  - a diterima month that ties;
  - a kind mismatch;
  - a re-import cancelling a slip;
  - refusals.
- [x] T3 UI in the Bukti potong card, actions, the Excel part. E2e.
- [x] T4 Gates.

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `lib/tax/coretax-match.ts`.
  - `matchOneToOne` over `Side` records, and `npwpDigits`.
  - The faktur recon moves onto it with no behaviour change; `tests/db/faktur.test.ts` is unchanged and green.

  `lib/tax/bupot-read.ts`:
  - The direction comes from the counterparty columns. The recipient wins, because a slip list the company made can also carry the
    company's own NPWP as *NPWP Pemotong*.
  - `kindOf` reads the KOP group (24/28/22/27), then the *Jenis Pajak* words.
  - Rate columns are never read as the tax.
  - Test: `tests/unit/bupot-read.test.ts`.
- T2: migration `20261007120000_coretax_bupot` with CHECKs on direction, kind and month, and `lib/tax/bupot.ts`: `importBupot`,
  `deleteBupot`, `bupotRecon` and `bupotNotes`.
  - The books' side is the masa's bank lines with PPh 23, 4(2) or 22 withheld, outgoing for dibuat and incoming for diterima.
  - `kindDiffers`.
  - MATCH only when the totals are equal and nothing is left unmatched or of another kind.

  Around it:
  - Control `bupot:<entity>`.
  - Audit kind `BUKTI_POTONG`; client delete; actions with `BupotError`; accounting-rules 5k.
  - Test: `tests/db/bupot.test.ts`.
- T3: the UI and the export.
  - `components/app/bupot-recon.tsx` (*Cocokkan dengan Coretax*) inside the Bukti potong card (`#bukti-potong`):
    - upload;
    - per direction: PPh slips, PPh di buku and Selisih;
    - *Jenis PPh berbeda*;
    - both unmatched lists, each withholding linked to the account it sits on (2141 / 2145 / 1180 / 8200);
    - *Hapus … masa ini*.
  - The banner names a slip gap after a faktur gap.
  - The Excel *Bukti Potong* sheet gets *Cocokkan dengan Coretax* when slips exist.
  - E2e: `e2e/bukti-potong.spec.ts`. The withholding is booked with the Review hint's *Potong PPh 23 2%*.
## Verification
- `tests/unit/bupot-read.test.ts` (4):
  - the dibuat list with the company's own NPWP column, a pembetulan counted and a cancelled slip not;
  - a diterima CSV with the masa taken from its date;
  - kinds by code and by words;
  - the refusals.
- `tests/db/bupot.test.ts` (3):
  - In dibuat, two slips are matched, one of them *beda jenis* (4(2) in the books, PPh 23 on the slip). One slip has no withholding in
    the books, and one withholding has no slip.
  - The *Bukti Potong* sheet carries the comparison.
  - Diterima ties.
  - A re-import cancels a slip. The control flags the masa and goes with the slips.
  - An individual's books are refused.
- `tests/db/faktur.test.ts` is unchanged and green on the shared matcher.
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 182 passed (182), Tests 1176 passed (1176);
  `npm run build` exit 0; `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`; `npm run test:e2e`
  on the local stack: 54 passed (5.1m).

## Ship Notes
- Migration `20261007120000_coretax_bupot`: a new table. No env var.
- Nothing changes until a firm uploads a Coretax slip list.
- Rollback: revert; the table can stay.

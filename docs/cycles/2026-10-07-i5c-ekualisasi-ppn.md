# I5c — Ekualisasi PPN: faktur Coretax vs buku

## Context
ADR 0014 I5 lists "Coretax faktur and bukti potong imports reconciled to PPN and PPh". Each month, before the SPT Masa PPN, an Indonesian
firm ties the faktur in Coretax to the books:
- *faktur keluaran* (approved) against PPN keluaran (2130);
- *faktur masukan* (credited) against PPN masukan (1150).

A gap is either a sale with no faktur (a fine), a faktur not booked (understated revenue), or a timing difference: the faktur is issued at
delivery, while Buku books PPN when the money arrives. Pajak Masa (I4c) shows the books' side only. The owner asked to "keep improving"
(2026-10-07).

Stage: **Laporan** (Pajak Masa).

## Spec
- [x] **Read a Coretax faktur export** (`lib/tax/faktur-read.ts`, pure). XLSX/XLS/CSV through `readSheets`.
  - The header row is found by its words (title rows above are skipped).
  - **Keluaran** is recognised by *NPWP/Nama Pembeli*, **masukan** by *NPWP/Nama Penjual*. A file with neither is refused in Bahasa.
  - Required columns: *Nomor Faktur*, *Tanggal Faktur*, *DPP* (*Harga Jual/Penggantian/DPP*; *DPP Nilai Lain* is kept as written but not
    used for the tie) and *PPN*. Optional: *Masa Pajak* + *Tahun* (else the masa is the faktur date's month), *Status Faktur*, *NPWP*,
    *Nama*.
  - Amounts with sen round half up to whole Rupiah per faktur, noted.
  - **Status**: cancelled, replaced, rejected and draft faktur (*batal, dibatalkan, cancel, diganti, replaced, reject, ditolak, draft*)
    are kept but not counted. For masukan, a faktur counts only when credited (*dikreditkan / credited*), or when the file has no status
    column. An approved-but-not-credited masukan is listed as *belum dikreditkan*.
  - Every row keeps `sheet!row`.
- [x] **Store** (`CoretaxFaktur`, migration): firm, client, entity, direction, number, faktur date, masa (year, month), counterparty NPWP
  and name, DPP, PPN, status as written, `counted`, file name, `sheet!row`, who and when. Unique per (entity, direction, number).
  - A re-import updates a faktur (its status can move from approved to cancelled) and says how many were new and how many changed.
  - *Hapus faktur* removes one direction's faktur for one masa, so a wrong file can be redone.
  - Audited; removed with the client (rule 25).
- [x] **Ekualisasi** (`lib/tax/faktur.ts` `fakturRecon`, read time). Per company and masa, per direction:
  - Faktur PPN counted vs the books (keluaran = 2130 credits of the month without openings, payments or remittances; masukan = 1150
    debits): equal within Rp 1 per faktur = **cocok**, else **selisih**.
  - **Line matching, one to one, exact PPN amount.** Each counted faktur is matched to a book line of the masa (a posting of a bank line or
    an invoice to 2130 / 1150). A same NPWP (invoice contact) or a shared name word comes first, then the earliest date. The result shows
    the faktur not in the books and the book PPN with no faktur, each with its source (bank row or invoice number), so the difference
    explains itself.
  - Nothing is posted: corrections go through Review, invoices or Jurnal Penyesuaian as today.
- [x] **On Pajak Masa:**
  - a card *Ekualisasi PPN (Coretax)*:
    - upload (keluaran or masukan, read from the file);
    - per direction: faktur vs buku, the difference and its status;
    - the unmatched lines both ways, with drill links to the ledger and invoices;
    - when nothing is imported for the masa, the card says what to export from Coretax.
  - The Excel workbook gets a sheet *Ekualisasi PPN*.
- [x] **Close control** `faktur:<entity>` *Faktur Coretax = buku* (REVIEW while either direction differs). It is added only when faktur
  for that masa were imported, so firms that don't use it see nothing new.

**Non-goals:**
- bukti potong (Unifikasi) import, which is a later cycle with the same pattern;
- calling Coretax or any DJP API (ADR 0014: not a PJAP);
- posting or proposing journals from faktur;
- DPP Nilai Lain arithmetic beyond carrying the column;
- PPnBM.

**Gate-reopeners:**
- one migration (`CoretaxFaktur`);
- no new dependency.

**Assumptions:**
1. Column names follow Coretax's *Daftar Faktur Keluaran / Masukan* export. Synonyms cover the e-Faktur 3.x names. A real client's file
   decides any further synonyms, as with banks.
2. One upload = one company's export (Coretax exports per taxpayer). The company is the one chosen on the page; the file's own NPWP is not
   trusted to route rows.
3. Exact PPN equality is the matching key. Bank-derived PPN is an estimate (rule 8): a receipt net of a customer's withholding will not
   match its faktur, and shows as a difference to look at, which is the point.

## Tasks
- [x] T1 `lib/tax/faktur-read.ts` + unit tests:
  - keluaran and masukan detection;
  - title rows;
  - masa from the columns, and from the date when absent;
  - status rules (cancelled, replaced, not credited);
  - sen rounding;
  - a missing column refused.
- [ ] T2 Migration + `lib/tax/faktur.ts`: `importFaktur` (upsert, counts, audit), `deleteFaktur`, `fakturRecon` (totals, one-to-one
  matching). Client delete. DB tests: a matching month; a faktur not booked; book PPN without a faktur; a cancelled faktur ignored; a
  re-import that cancels a faktur; another firm's client refused.
- [ ] T3 The card on Pajak Masa, the actions, the Excel sheet and the close control. E2e: upload keluaran with one cancelled and one
  unbooked faktur, see the difference explained, and see the control.
- [ ] T4 Gates.

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `lib/tax/faktur-read.ts` reads with `readSheets`.
  - The header row is found by its column words: *DPP Nilai Lain* and *PPnBM* are never the DPP or the PPN.
  - The direction comes only from the counterparty NPWP or name column. A keluaran export also has *Dilaporkan oleh Penjual*.
  - The masa is read from a number, an `MM-YYYY` value or a month name; otherwise it is the faktur date.
  - A duplicated faktur number is refused.
  - Test: `tests/unit/faktur-read.test.ts`.
## Verification
## Ship Notes

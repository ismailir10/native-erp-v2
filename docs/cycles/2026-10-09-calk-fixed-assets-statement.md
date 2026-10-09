# CALK: a fixed-asset movement schedule and a Surat Pernyataan that can be signed

## Context
These are the next two items from the partner review of the report pack (see `2026-10-09-report-pack-partner.md`, Context). Both are
things a partner fills in by hand today before sending the set:

1. **No movement schedule for fixed assets.** PSAK 216 (SAK EP Bab 17 likewise) asks for a reconciliation of the carrying amount:
   opening, additions, disposals, depreciation, closing. The CALK lists each register asset (cost, accumulated depreciation, book value)
   and gives *Akumulasi penyusutan* a separate note, printed negative. A client with no register (books imported from a ledger) gets
   no detail beyond the account balances.
2. **The Surat Pernyataan is a stub.**
   - It has one line, "Nama: ____ Jabatan: …".
   - It has no address, domicile or telephone fields, and no place, date or materai space at the signature.
   - The page header repeats the title and adds "Per 31 Jul 2026".
   - It prints last, while Indonesian sets put it before the statements.

Approval: the owner's brief in-session ("continue improving Buku until we are proud with our work").

## Spec
- [x] **F1** The CALK note for *Aset tetap* carries a **movement schedule** from the GL (accounting-rules 1). Each account of the
  *Aset tetap* and *Akumulasi penyusutan* lines gets one row with these columns: balance at the year's opening (the previous year end
  plus the year's Saldo Awal, the same opening as Perubahan Ekuitas and Arus Kas), additions, deductions, and the balance at the period
  end. The cost accounts are grouped under *Harga perolehan* and the accumulated accounts under *Akumulasi penyusutan* (negative). The
  total is *Nilai buku*. Each row adds up, and the closing book value equals the Neraca. The register's per-asset table stays below it
  when there is a register. *Akumulasi penyusutan* no longer gets a note of its own.
- [ ] **F2** The **Surat Pernyataan**:
  - It gives fields to fill for the signer: Nama, Alamat kantor, Alamat domisili sesuai KTP, Nomor telepon, Jabatan.
  - It closes with "Atas nama dan mewakili <entitas>", a place and date line, a materai space ("Meterai Rp10.000") and the name and
    role under the signature.
  - In the PDF it comes right after the statements' first page header, before the Neraca, and its page header carries only the entity
    (no repeated title, no "Per …").
  - The workbook keeps its sheet order.

**Non-goals:** a register-based schedule by asset class; a cover page; signatures or e-materai.

**Gate-reopeners:** none. No migration, dependency or AI. No figure changes: the schedule is read from the same GL as the Neraca.

**Assumptions:**
1. The schedule is per GL account (1210, 1219, client accounts mapped to those lines), not per register class. A ledger-fed client has
   no register, and the GL is the source of truth.
2. Right-of-use accounts (1230/1239) sit on the same FS lines and appear in the schedule too, so its book value equals the Neraca line.
   The lease note keeps its own detail.

## Tasks
- [x] T1 `fixedAssetMovement` (lib/reports/statements.ts) + the CALK note. Accept: a db test with an opening, a purchase, depreciation and a
  disposal, where every row adds up, the book value equals the Neraca and there is no separate *Akumulasi penyusutan* note.
- [ ] T2 Surat Pernyataan fields and PDF placement. Accept: tests on `directorsStatement` and the PDF page order. The page is looked at.
- [ ] T3 End-of-cycle gates and Ship Notes.

## Implementation
- Plan: T1–T3 sequential, inline (stacked on `task/report-pack-partner`: same files).
- T1: `lib/reports/statements.ts` (`fixedAssetMovement`: every ASET_TETAP / AKUM_PENYUSUTAN account from `yearOpening` to the period end,
  additions/deductions signed so each row adds up), `lib/reports/notes.ts` (the *Aset tetap* note leads with the movement table under
  *Harga perolehan* / *Akumulasi penyusutan*, total *Nilai buku*; the separate *Akumulasi penyusutan* note is dropped and the notes renumbered;
  the register's per-asset table follows). Test: `tests/db/asset-movement.test.ts` (opening, purchase, four months' depreciation, a disposal
  at a loss: rows add up, book value = Neraca, numbering continuous).
## Verification
- T1: lint clean · typecheck clean · `npm test` 198 files, 1316 passed.
## Ship Notes

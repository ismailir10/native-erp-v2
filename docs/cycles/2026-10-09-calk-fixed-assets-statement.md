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
- [x] **F2** The **Surat Pernyataan**:
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
- [x] T2 Surat Pernyataan fields and PDF placement. Accept: tests on `directorsStatement` and the PDF page order. The page is looked at.
- [x] T3 End-of-cycle gates and Ship Notes.

## Implementation
- Plan: T1–T3 sequential, inline (stacked on `task/report-pack-partner`: same files).
- T1: `lib/reports/statements.ts` (`fixedAssetMovement`: every ASET_TETAP / AKUM_PENYUSUTAN account from `yearOpening` to the period end,
  additions/deductions signed so each row adds up), `lib/reports/notes.ts` (the *Aset tetap* note leads with the movement table under
  *Harga perolehan* / *Akumulasi penyusutan*, total *Nilai buku*; the separate *Akumulasi penyusutan* note is dropped and the notes renumbered;
  the register's per-asset table follows). Test: `tests/db/asset-movement.test.ts` (opening, purchase, four months' depreciation, a disposal
  at a loss: rows add up, book value = Neraca, numbering continuous).- T2: `notes.ts` (`directorsStatement`: Nama/Jabatan, Alamat kantor, Alamat domisili sesuai KTP, Nomor telepon; place-and-date line,
  "Atas nama dan mewakili <entitas>" — not for an individual —, "Meterai Rp10.000", the name line and the role last), `pdf.ts` (the
  statement opens the PDF; its header carries the entity only; the draft reasons move to the Neraca's page and later pages point to it;
  room to sign over the meterai; a sub-item keeps its indent). Tests: `tests/unit/directors-statement.test.ts` (fields, atas nama),
  `report-pdf` / `report-pdf-layout` (page order and draft lines). Page 1 rendered and looked at.- Review (Codex on #131): the schedule takes only `type === "ASET"` accounts on the two lines (the Neraca's own test), and a manual entry
  reversed inside the period (*Balik jurnal*, `reversesId`) leaves both entries out of the additions / deductions (they cancel; closing
  unchanged). Test: `asset-movement.test.ts` (+1).
## Verification
- T1: lint clean · typecheck clean · `npm test` 198 files, 1316 passed.
- T2 + end of cycle: lint clean · typecheck clean · `npm test` 198 files, 1316 passed · `npm run build` ok · `npm run test:e2e` 61 passed
  (6.4m) · `demo:reset && verify:books` → ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.

- Review fix: lint clean · typecheck clean · `npm test` 198 files, 1317 passed.

## Ship Notes
- Stacked on `task/report-pack-partner` (PR #130): it merges after that one (GitHub retargets it to `main` when #130's branch goes).
- No migration, env var, dependency or AI call; no figure changes (the schedule reads the same GL as the Neraca).
- Visible changes: the PDF opens with the Surat Pernyataan; the CALK *Aset tetap* note leads with *Mutasi aset tetap*, and *Akumulasi
  penyusutan* no longer has a note of its own (later notes renumber).
- Deck: no deck change — the decks don't list CALK contents or the statement's layout.
- Rollback: revert.

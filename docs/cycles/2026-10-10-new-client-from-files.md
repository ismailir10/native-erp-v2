# New client from files

## Context
"Klien baru" today is a form: client name, industry, then each company or owner (type, full and short name, NPWP,
currency) and every rekening (bank, number, label). On 2026-10-10 the test client needed one PT and one owner with
seven rekening — every value was printed on the statements the accountant already had. After the Unggah inbox
(`2026-10-10-unggah-inbox.md`) can propose rekening and owners from files, the same reading can start the client.

## Decisions
1. **"Klien baru" starts from files.** Two inputs: client name (prefilled from the first company holder found, editable)
   and a drop zone / Drive folder link. Buku reads the files and proposes, in one card: the entities (a holder with
   PT/CV/Tbk → company; a person's name → pemilik; NPWP when printed), and every rekening under its entity. One
   *Buat klien & impor* creates the client, entities and rekening, then lands on the client's Unggah page with the
   files already booked (same per-file list).
2. **The manual form stays** as "Isi manual" for clients without files yet.
3. **Nothing is guessed silently.** Entities and rekening the card proposes are visible and editable before creation;
   files that can't be assigned stay in the client's Dokumen with their reason.

## Acceptance criteria
- [ ] From Beranda, a new client is created from the walk's file set (synthetic copies) with one PT, one pemilik and
      all rekening in one confirmation; the client opens on Unggah with every statement booked.
- [ ] Editing a proposed entity name or moving a rekening to another entity in the card is respected.
- [ ] Holder names that look like the same person/company with spacing/case/PT-prefix differences become one entity.
- [ ] The manual path still works unchanged; the investor demo walk passes.

## Verify flows
1. Admin → Klien baru → name + drop synthetic statements (PT + owner, 5 banks) → card → *Buat klien & impor* → Unggah
   shows booked files; Pengaturan klien lists the entities and rekening.
2. Edge: files from two different companies → card proposes two companies; user removes one → its files stay in
   Dokumen only.
3. Error: only unreadable files → card says nothing could be read and offers *Isi manual*.

## UX notes
- Klien baru: "Nama klien" + drop zone "Tarik rekening koran klien ke sini — Buku menyiapkan perusahaan, pemilik dan
  rekeningnya." Link below: "Belum ada file? Isi manual".
- The card reuses the Unggah confirm card, grouped by entity.

## Test seams
- Unit: holder → entity proposal (company vs person, name normalisation).
- DB integration: create client + entities + rekening + imports in one action; partial assignment.
- e2e: flow 1.

## Non-goals
- Reading NPWP or addresses beyond what statements print; industry detection.
- Ledger/neraca-driven setup (entities from a trial balance) — later if needed.

## Assumptions
1. Builds on the Unggah inbox cycle (confirm card, sorting, keyring) and the reader `holder` field.
2. Client name defaults to the first company holder, else the first person's name.

## Gate re-openers
- Sensitive path: `app/actions.ts` (new create-from-files action; same permission as `client.create`). No schema
  change expected beyond the inbox cycle's.

## Tasks
- [ ] T1 Proposal model: holders → entities (company/person, normalised), rekening grouped — accept: unit tests.
- [ ] T2 Create-from-files action: client + entities + rekening + hand-off to Unggah processing — accept: DB tests.
- [ ] T3 Klien baru page: name + drop + card + *Isi manual* — accept: verify flows 1–3.
- [ ] T4 e2e + docs + full gate — accept: green.

## Implementation

## Verification

## Ship Notes

# Hard E2E on production: a new group client (Chickin) and real bank statements (Belifi)

## Context
The owner asked for a second hard end-to-end usability test on production (2026-10-08), with real files from the shared Drive, judged
as an Indonesian accountant would. Two fresh clients were walked from **Tambah klien**:

- **Chickin Group**: Chickin Pte. Ltd. (SGD, *Badan usaha asing*) and four PTs (SKP, CSP, CAH, SPN). The client's GL/TB/FS reconstruction
  workbook was imported: the holding company's GL (1.027 rows, USD/SGD face values), the operating companies' GL (3.437 rows, 691
  accounts, 4 entities) and the holding company's 2022 opening sheet.
- **Belifi (uji bank)**: PT Belifi Mahajaya Nusantara (BCA giro, June 2026 e-statement) and the owner Alfi Yandra (SMBC combined PDF,
  May 2026: Jenius, Giro Karya and a PRK loan account, plus a time deposit).

What held up: both statements parse with continuity intact; the SMBC file's other accounts import with one click; Saldo Awal is
prefilled (PRK on the credit side, the deposit proposed); every posted balance ties to the workbook's GL per account and entity
(e.g. SKP BCA Rawasari Rp 27.210.777.768 vs 27.210.777.767,87); the import checks catch the client's own errors (USD/SGD face-value
journals, unbalanced batches, reused account codes); Tutup Buku raises the right findings (PPh badan unbooked, stock count, tax
payables in debit, missing translation rates).

What an accountant would not accept:

| # | Stage | Finding | Cause |
|---|---|---|---|
| 1 | Review | PT → owner "TRSF … Belifi ALFI YANDRA" Rp 152 jt went to AI → **2110 Utang Usaha 80%**, inside the "Terima usulan AI yakin" bulk button | the bank remark repeats the payer's own name ("Belifi" for PT Belifi Mahajaya Nusantara); one word of a multi-word own name is not stripped, so the line looks like a third party and skips the 1190 review branch |
| 2 | Review | The owner's (Perorangan) BI-FAST lines: AI proposes **1130 Piutang Usaha** / **2110 Utang Usaha** | the AI prompt carries only the client name; it never knows the line belongs to an individual |
| 3 | Laporan | For any IDR company of the group, **Laporan Keuangan shows only "kurs belum lengkap"** for the SGD holding company | the group's combined worksheet is computed inside the same FX guard as the entity's own statements |
| 4 | Pemetaan | "Communication and **Internet** Expense", "Shipment to **Internal**" → **6100 Beban Gaji** | keyword `intern` is not word-bounded and sits before the utilities rule |
| 5 | Pemetaan | Deferred tax asset → **1260**, deferred tax expense → 8100, right-of-use → 1250 | rules predate the template accounts 1270, 8110, 1230 |
| 6 | Pemetaan | "Tax Expense - Vehicle" → **8100 Beban Pajak Penghasilan** | any "tax expense" is read as income tax |
| 7 | Pemetaan | "[UNMAPPED] Inventarisasi Biologis" (Rp 43 M live birds) → **1210 Aset Tetap** | "inventaris" (office equipment) matches first |
| 8 | Pemetaan | "Production Cost - Makloon …" (client code 50017) → new account **6191** under operating expenses | a generic "expense" match always proposes a new account under Beban Umum, ignoring the client's code scheme (5xxxx = cost of sales) |
| 9 | Impor | The holding company's opening sheet is refused: "Adjustment bukan angka: YES (…)" ×11, "fix the file" | a yes/no column "Pooling Adj Integrated?" and the empty "Net Movement" / "Closing … Impact" columns are read as TB column groups |
| 10 | Beranda | Opens on **Januari 2027** (today is October 2026) | default = latest month with data across clients, future months included |
| 11 | Tambah klien | NPWP placeholder is the old 15-digit format; a Perorangan defaults to SAK EP with PT/CV wording | form defaults |
| 12 | Impor | SGD ledger: "Pembulatan sen ke **Rupiah**"; *Batalkan draf* leaves the accountant on the cancelled draft; entity names cut off in the scope picker | copy and small UI |

## Spec
- [ ] **Own transfers named by the payer's own name wait on 1190.** A line with a transfer word that names another group entity, where
  what is left after own names is only short codes **or words of the line's own entity name** (one word of a multi-word name counts here),
  is suggested 1190 at review confidence. Never auto-posted; never sent to AI. "Belifi ALFI YANDRA" from PT Belifi Mahajaya Nusantara → 1190.
  A customer receipt "bayar nota … Belifi DINA PUSPITA" still names a third party and is unchanged.
- [ ] **AI classification knows the entity.** The prompt states the entity's kind (badan usaha / perorangan-pemilik). For a PERORANGAN line
  the account list sent excludes trade receivables, trade payables and sales (1130, 2110, 4100, 4110); answers outside the list are dropped
  as today (rule 19). Prompt version bumps (cached answers for the old prompt are not reused).
- [ ] **An entity's own report never waits for the group's rates.** Laporan Keuangan for one entity renders its Laba Rugi / Neraca when another
  entity lacks translation rates; the Kertas Kerja Gabungan tab shows the compact "kurs belum lengkap" card instead.
- [ ] **Mapping rules** (suggestions only; accepted mappings are untouched):
  - `intern` matches only as a word (internship/intern), so "Internet" → 6130 and "Internal" falls through.
  - deferred tax: asset → 1270, liability → 2300 (unchanged), expense → 8110; right-of-use asset → 1230, its accumulated depreciation → 1239.
    Template accounts are created on posting when the client predates them (as 1135 today).
  - "tax expense" with vehicle / kendaraan / PBB / stamp / meterai / retribusi / regional words → 6190, not 8100.
  - biologis / biological → 1160 Persediaan.
  - A generic match that proposes a new account uses the client's code scheme: a leading digit learnt as cost of sales (≥ 3 votes ≥ 80 %)
    proposes the new account under HPP, not Beban Umum.
- [ ] **TB column groups need numbers.** A column group whose data cells hold no number (blank or text only) is not a group. The Chickin
  foundation sheet reads as a Neraca from its Debit / Credit columns, with no BLOCK issue.
- [ ] **Small things:** default period is the latest data month not after the current month; NPWP placeholder `0000 0000 0000 0000` (16 digits;
  15-digit input still accepted); a new Perorangan defaults to SAK EMKM; the rounding note names the entity's currency; *Batalkan draf* returns
  to Impor; the scope picker shows full entity names.

**Non-goals:**
- Closing many historical months at once (Chickin needs 36 closes). Rule 23 requires controls and sign-offs per month; a bulk close is a
  product decision of its own — proposed as a follow-up, not built here.
- Receipts on 1130 vs 4100 when no receivable exists (the "saldo berlawanan" control already flags it); AI judgement on QRIS fees or cash
  differences; entering SGD→IDR rates; converting the holding company's face-value USD rows.
- Deleting the production test clients (Kopi Nusa, Chickin, Belifi uji bank): only on the owner's word.

**Gate-reopeners:** none of migration or dependency. The prompt version bump means the next imports call the model again for leftovers
(normal per-import caps and the monthly budget apply). Mapping and classification changes can move demo numbers → `verify:books`.

**Assumptions:**
1. For a Perorangan, 1130 / 2110 / 4100 / 4110 are never right for a personal bank line; anything else stays available to the model.
2. "Own entity word" (spec 1) only widens the review-only 1190 branch, so a wrong guess costs a review, never a posting.
3. Rule changes apply to new suggestions; production mappings already accepted (Chickin, Goers) stay until re-mapped by the accountant.
4. The six small items ship in one task.

## Tasks
- [x] T1 Own-entity words in the 1190 review branch (`lib/classify/transfer.ts`) — accept: unit test with the Belifi line → 1190 review; customer receipt unchanged; existing transfer tests green.
- [ ] T2 Entity kind in AI classification (`lib/ai/provider.ts`, `lib/ai/classify.ts`, caller in `lib/import`) — accept: unit test on `buildPrompt` / account filter; MockProvider DB test for a Perorangan import; prompt version bumped.
- [ ] T3 Entity reports independent of group rates (`app/(app)/clients/[id]/reports/page.tsx`) — accept: DB/e2e-free check by rendering helper or manual local run with an SGD entity lacking rates; typecheck.
- [ ] T4 Mapping rules (`lib/ledger-import/mapping.ts`, posting of template accounts) — accept: `tests/db/mapping.test.ts` cases for the seven Chickin names above; prior expectations kept.
- [ ] T5 TB groups need numbers (`lib/ledger-import/read.ts`) — accept: synthetic fixture of the foundation-sheet shape reads as NERACA with 0 BLOCK; existing TB tests green.
- [ ] T6 Small things (`lib/periods.ts`, client form, ledger draft page, scope picker, rounding copy) — accept: unit test for the period cap; browser check.

## Implementation
- Plan: tasks T1–T6 sequential, done inline (each is small and touches a different area; one driver keeps the review tight).
- T1: `lib/classify/transfer.ts` — the 1190 review branch also takes out words (≥ 4 letters) of the line's own entity names; an empty remainder gets its own reason. Test: `tests/unit/transfer-safety.test.ts` (Belifi-shaped line with only the full PT name → 1190 at 0.8; customer receipt untouched).

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 183 passed (183), Tests 1205 passed (1205).

## Ship Notes

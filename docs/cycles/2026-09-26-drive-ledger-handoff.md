# Drive evidence → ledger handoff for real group workbooks

## Context
The first end-to-end run of a real client workbook through **Dokumen → Google Drive** (Chickin group reconciliation workbook,
production, 26 Sep 2026) connected Drive, read the folder, and created the client. It stopped before posting: only
1 of the 3 postable sheets could be handed to the ledger import. The accountant would have to leave the Drive workflow
and re-upload the same file in **Impor → Buku besar**. The findings are recorded outside the repo (private data); the
synthetic reproduction below carries every shape that matters.

What went wrong, with the root cause in code:

| # | Symptom | Cause |
|---|---|---|
| 1 | Multi-entity GL sheet (entity column SKP/CSP/CAH/SPN) refused: "File mencakup entitas lain…" | `EvidenceSelection` holds one `entityId`; `stageImport` `allowedPeriod.entityId` rejects any other entity (`lib/ledger-import/post.ts:119`) |
| 2 | HoldCo GL sheet classified **BANK**, so it asks for a bank account, then refuses SGD | `kindOf()` (`lib/evidence/extract.ts:83`) tests bank keywords first; memo cells say "Rekening koran…" |
| 3 | 11 derived sheets (movement/TB engines, action log, IC mapping, registers) default to **Sumber pencatatan** | role = SOURCE for any LEDGER/BANK keyword hit; nothing checks the sheet is a postable table |
| 4 | Opening neraca would post on 2023-01-01 instead of 2022-12-31 | the file states no balance date; staging falls back to the selection's `periodEnd`, taken from a prose line ("Closing 31 Dec 2022 … Opening 1 Jan 2023"), and the selection must cover that 2-day hint |
| 5 | "Nama perusahaan: Source Type / Calendar Year / GL Entry ID / PASS"; new-client form prefilled 7 junk entities (one AUD) | entity regex runs on `|`-joined rows, so a header row `Entity | GL Entry ID | …` reads as label → value |
| 6 | Opening the file renders ~7.4 M characters; tooling and the page freeze | one issue per formula cell without a cached result (up to 15,244 on one sheet) |
| 7 | Toast "Unsupported state or unable to authenticate data" | Drive refresh token encrypted with an older `SETTINGS_SECRET`; `decryptSecret` error surfaces raw |
| 8 | Reconnect failed twice with no trace | `/api/google/callback` catches everything and returns `?google=error` without a reason or log line |

`detectTables()` (`lib/ledger-import/read.ts:131`) — the manual import's own table detector — finds exactly the three
postable sheets in that workbook (one NERACA, two LEDGER) and none of the 27 derived ones. It becomes the authority.

Outcome: from one Drive folder, an accountant can confirm the three source sheets and open three ledger drafts, all
posting through the existing check → map → post path. Everything else in the workbook stays evidence.

## Spec
Extraction (`lib/evidence/extract.ts`)
- [ ] XLSX/CSV units carry `table: { mode: "LEDGER" | "NERACA", entities: string[], periodStart, periodEnd, date }` when
      `detectTables()` + `readTable()` recognise the sheet. Such units get kind LEDGER, role SOURCE. No other unit
      defaults to SOURCE in a workbook. A sheet with ledger/bank keywords but no postable table is COMPARISON (report-like) or CONTEXT.
- [ ] BANK kind needs a statement-shaped header row (date + description + debit/credit or mutation + balance), not a
      keyword anywhere in the first 40 rows. A detected ledger table always wins over BANK.
- [ ] Entity/company name is read only from a label → value pair: one cell `Label: value`, or a row with exactly two
      non-empty cells. Multi-column header rows never produce an entity or a `companyName` fact.
- [ ] Per-cell issues are aggregated per sheet and kind: e.g. `1.027 rumus belum memiliki hasil tersimpan (contoh: I5, I6, I7). Hitung ulang dan simpan di Excel.`
      At most 20 issue lines per unit; the rest are summarised as a count.

Selection and handoff (`lib/evidence/review.ts`, `lib/ledger-import/post.ts`)
- [ ] NERACA unit: the accountant confirms a single **Tanggal neraca** (periodStart = periodEnd). A date written in the
      file must equal it. The text-derived period hint no longer has to be covered. The OPENING entry is dated with that date.
- [ ] LEDGER unit with an entity column: entity choice **"Sesuai kolom Entitas di file"** (stored as `entityId = null`).
      On confirm, every file label must match a client entity by short or full name (the same rule `stageImport` uses),
      all matched entities must share the confirmed currency, and the overlap check runs per matched entity. Unmatched
      labels are listed in the error ("Tambahkan entitas SKP, CAH ke klien atau gunakan impor manual.").
- [ ] `stageImport`'s `allowedPeriod` accepts a set of entity ids; the evidence handoff passes the matched set. A file
      entity outside the set is still refused. Manual import is unchanged.
- [ ] Postable units never take the bank path. `prepare()` uses the unit's `table`, not text keywords, to choose ledger staging.

UI (`components/app/evidence-workspace.tsx`)
- [ ] Table units show mode ("Buku besar · 3.437 baris · 4 entitas" / "Neraca · tanpa tanggal"). A neraca shows one date
      field. A multi-entity ledger shows the entity-column option, preselected. No bank-account field appears for table units.
- [ ] Unit issues render at most 5 lines, then a "+N lainnya" disclosure. The expanded Chickin-shaped fixture stays under 50 kB of text.
- [ ] The new-client proposal is built from the cleaned `companyName` facts only (no header junk). Behaviour is otherwise unchanged.

Drive errors (`lib/evidence/jobs.ts`, `app/api/google/callback/route.ts`)
- [ ] A refresh token that can't be decrypted raises `DriveError("RECONNECT")` with the message "Koneksi Google perlu
      dihubungkan ulang oleh admin." — never the crypto text.
- [ ] The OAuth callback logs one line per failure with an allowlisted reason (`state`, `denied`, `no_refresh_token`,
      `scope`, `invalid_client`, `exchange`, `config`) and redirects `?google=error&reason=<reason>`. The alert names the
      likely fix (e.g. scope → "centang izin Google Drive"). Codes, tokens and secrets never appear in URLs or logs.

Tests, docs
- [ ] A synthetic fixture workbook reproduces every shape above (invented names and figures).
- [ ] A DB test goes from intake → confirm 3 sources → prepare → post. It checks the journals split per entity, every
      entry keeps `ledgerImportId` + `sheet!row`, and the OPENING entry is dated with the chosen date.
- [ ] Update `docs/evidence-workspace.md` (multi-entity ledgers, neraca date, re-read = new collection).

**Gate-reopeners:** none. No schema migration (`EvidenceSelection.entityId` is already nullable; `table` lives in the
existing `units` JSON). No new dependency. No AI calls. Posting still runs only through `stageImport` → `postJournal`
(accounting-rules 2, 15, 15a unchanged).

**Non-goals:**
- Re-extracting existing evidence versions. To pick up the fix, the Chickin run makes a **new collection** of the same
  folder and links the existing empty client.
- A kind/role override beyond what `detectTables()` supports; sheets it can't read still go through manual import.
- Using file entity labels to propose new-client entities.
- Raising extraction caps (the "Ekstraksi dibatasi" limit).
- AI key re-encryption when `SETTINGS_SECRET` changes (operational: re-save in Pengaturan).
- Mixed-currency multi-entity sheets (refused with a manual-import hint).
- Bank handoff changes.

**Assumptions:**
1. `detectTables()` is the single authority for "postable". A sheet it rejects in the manual import can't be a Drive source either.
2. Entity matching for the entity column = exact short-name or full-name match (case-insensitive), as `stageImport` does
   today. No fuzzy matching; mismatches are an explicit error.
3. The multi-entity selection's confirmed currency must equal every matched entity's functional currency (IDR for the
   Chickin OpCos). HOLDCO (SGD) is its own single-entity sheet.
4. For a neraca without a date in the file, the accountant types the date. No guessing from prose.
5. Existing selections and imports are untouched. Only new extractions carry `table`; units without it keep today's behaviour,
   except they no longer default to SOURCE.
6. After ship, the Chickin production run resumes: new collection of `buku-e2e-chickin` → link "Chickin (uji Drive)" →
   3 drafts → Kurs → reports vs ground truth.

## Tasks
- [x] T1 Fixture: synthetic workbook builder in `tests/evidence-workbook-fixture.ts` (README, source register with "Rekening koran" memos,
      neraca without date plus a prose "Closing … Opening …" line, single-entity SGD GL with an `Entity | GL Entry ID | …` header, 4-entity IDR GL,
      2 engine sheets with formulas lacking cached results). Reuse ExcelJS as `tests/pdf-fixture.ts` does for PDFs — accept: fixture loads in `detectTables()` with 3 candidates.
- [x] T2 Extraction: `table` on units via `readSheets`/`detectTables`/`readTable` (reuse `lib/ledger-import/read.ts`); role/kind rules; statement-shaped BANK;
      label/value entity rule — accept: unit test on the fixture shows 3 SOURCE units (NERACA, LEDGER×2), 0 other SOURCE, no header entity, no BANK.
- [x] T3 Issue aggregation (per sheet + kind, ≤20 lines) — accept: unit test shows the engine sheet's thousands of formula cells as one line with a count and 3 examples.
- [x] T4 Handoff: neraca date rule; entity-column selection (`entityId = null`), label matching helper shared with `stageImport`, per-entity overlap check;
      `allowedPeriod.entityIds` — depends T2 — accept: DB test intake → confirm 3 → prepare → `postImport` posts; journals per entity; OPENING dated as chosen; overlap and unmatched-label errors covered.
- [x] T5 UI: table summary, neraca date field, entity-column option, no bank field for tables, issue disclosure (≤5 + "+N lainnya") — depends T4 —
      accept: e2e `evidence-workspace.spec.ts` uploads the fixture and reaches a multi-entity ledger draft; page text length < 50 kB.
- [x] T6 Drive errors: RECONNECT on decrypt failure; callback reason codes, log line, alert copy — accept: unit tests in `evidence-oauth.test.ts` / `evidence-drive.test.ts` for each reason; no token/code in the redirect or logs.
- [x] T7 Docs: `docs/evidence-workspace.md` (+ `docs/real-data.md` pointer) — accept: describes multi-entity handoff, neraca date, new-collection re-read.
- [ ] T8 End-of-cycle gates: lint, typecheck, test, build, `verify:books` ALL PASS, `test:e2e` green — accept: all green.

## Implementation
- Plan: tasks T1–T8 sequential, done inline (T2–T5 share the unit/selection contract; each builds on the previous).
- T1: `tests/evidence-workbook-fixture.ts`, `tests/unit/evidence-workbook.test.ts` — synthetic group workbook (HoldCo SGD + 4 IDR OpCos) with every failing shape.
- T2: `lib/evidence/{extract,types}.ts`, `lib/ledger-import/read.ts` — units carry `table` from `detectTables`/`readTable`; LEDGER only for postable tables, BANK only with bank wording + statement header; coverage from table rows (no prose dates); company names only from label → value pairs, never header/status words. Fixed a latent crash: `cellText`/`cellDate` threw on Excel's Invalid Date (manual import too). Old mixed-workbook test now gives its bank/GL sheets real headers.
- T3: `lib/evidence/extract.ts` — per-cell issues (uncached formula, invalid date, precision, cell error, ambiguous separator, unparsable amount) grouped per sheet with count + 3 cell examples; sheet-level issues first; ≤20 lines then "Dan N temuan lain." Single occurrences keep their original text.
- T4: `lib/evidence/review.ts`, `lib/ledger-import/post.ts` — `entityForLabel()` shared by `stageImport` and the handoff; `allowedPeriod.entityIds`; selection "Sesuai kolom Entitas di file" (`entityId = null`) resolves every label (unmatched listed, mixed currency refused); a chosen entity that is one of several labels is refused with the hint; NERACA takes one typed date (must equal a file date if any); overlap check intersects entity sets across all client intakes; table units never take the bank path. New `tests/db/evidence-handoff.test.ts`.
- T5: `components/app/evidence-workspace.tsx`, `lib/evidence/workspace.ts`, `e2e/evidence-workspace.spec.ts` — table summary ("Buku besar · 8 baris · 4 entitas", "Neraca · 3 akun · tanggal belum tertulis"), one *Tanggal neraca* field, entity option "Sesuai kolom Entitas di file (…)" preselected for several labels, single label preselects that entity, currency prefilled from the entity, no Rekening for tables, issues ≤5 + "+N lainnya". Proposals ignore the unconfirmed selection rows extraction stores. New e2e: upload the fixture, create the 5-entity client in the proposal form, confirm + prepare neraca and the 4-entity ledger, open the draft.
- T6: `lib/evidence/{drive,jobs}.ts`, `app/api/google/callback/route.ts`, `app/(app)/documents/page.tsx`, `components/app/evidence-workspace.tsx` — undecryptable token → `DriveError(RECONNECT)` "Koneksi Google perlu dihubungkan ulang oleh admin."; token endpoint `invalid_client`/`unauthorized_client`/`redirect_uri_mismatch` → `CONFIG`; missing Drive scope → `SCOPE`; callback redirects `?google=error&reason=<state|denied|exchange|no_refresh_token|scope|invalid_client|config>` and logs only `google oauth callback failed: <reason>`; `/documents` alert names the fix per reason.
- T7: `docs/evidence-workspace.md`, `docs/real-data.md` — postable-sheet rule, entity-column option, neraca date, issue summaries, new collection to re-read, callback reasons, Drive path pointer from the real-data ledger section.
## Verification
- T1: fixture test 1/1; current extractor on it: 10_HC_GL_MASTER → BANK, entities "Source Type"/"GL Entry ID"/"PASS", 8/8 units SOURCE, neraca hint 2025-12-31..2026-01-01, 1,603 issues on the engine sheet (bugs reproduced). Gate: lint ✔, typecheck ✔, `Test Files 45 passed (45) · Tests 349 passed (349)`.
- T2: fixture → sources exactly [04 NERACA, 10 LEDGER, 20 LEDGER], 0 BANK, 0 names. Local run on the private Chickin file: 3 sources (04 NERACA 11 rows no date; 10 LEDGER HOLDCO 2023-01-03..2025-12-31; 20 LEDGER SKP/SPN/CSP/CAH 2022-12-31..2025-12-31), `companyName` facts []. Gate: lint ✔, typecheck ✔, `Test Files 45 passed (45) · Tests 351 passed (351)`.
- T3: fixture engine sheet → one line `1.600 rumus belum memiliki hasil tersimpan (contoh: D3, E3, F3)…`; 30 distinct cell errors → 20 lines ending "Dan 11 temuan lain." Private Chickin file: ~98k issue lines → 113 lines / 7,320 chars (max 5 per sheet). Gate: lint ✔, typecheck ✔, `Test Files 45 passed (45) · Tests 353 passed (353)`.
- T4: handoff DB test — neraca + HoldCo GL + 4-entity OpCo GL confirmed, prepared, mapped, posted; OPENING dated 2025-12-31 on HOLDCO; OpCo entries on OPA–OPD, Σdebit 10,000,000; every `sourceRef` = `sheet!row`; 3 imports POSTED with the evidence version. Gate: lint ✔, typecheck ✔, `Test Files 46 passed (46) · Tests 358 passed (358)`.
- T5: `playwright test e2e/evidence-workspace.spec.ts` → 3 passed (26.6s); drafts in DB: `04_HC_FOUNDATION DRAFT NERACA [""]`, `20_OPCO_GL_MASTER DRAFT LEDGER [OPA, OPB, OPC, OPD]`; expanded workbook `main` text < 50 kB; screenshot checked. Gate: lint ✔, typecheck ✔, `Test Files 46 passed (46) · Tests 358 passed (358)`.
- T6: oauth/drive/token unit tests 48 passed (reasons per path; warn line holds only the reason; `invalid_client` message hides provider text; decrypt failure → RECONNECT). Gate: lint ✔, typecheck ✔, `Test Files 47 passed (47) · Tests 361 passed (361)`, build ✔.
## Ship Notes

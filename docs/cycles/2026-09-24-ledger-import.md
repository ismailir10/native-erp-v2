# Cycle 2: ledger + Neraca import, per-entity accounts, multi-currency, source checks, SMBC combined statements

## Context
Three real test cases arrived, and none of them is a clean single-account IDR bank statement:
- **Chickin**: a group rebuild workbook covering FY2022–2025: HoldCo (Chickin Pte Ltd, Singapore, **SGD** books with USD and SGD
  bank accounts) + 4 Indonesian companies (SKP / CSP / CAH / SPN). The ledger is monthly/yearly totals per account (3,437 rows
  for the Indonesian companies, 1,027 for HoldCo). The workbook has its own TB and FS tabs and a register of 24 problems the
  consultant found. Each company has its **own** account codes (SKP 284, CSP 224, CAH 97, SPN 86, HoldCo 14), and the same code
  means different things in different companies (21003).
- **Goers**: Jurnal (Mekari) exports only: Neraca 31 May 2026, Laba Rugi Jan–May, Arus Kas. About 200 accounts with codes like `4-4027`.
- **SMBC Touchbiz May 2026**: one PDF with a combined statement for several accounts (savings, current account, an
  overdraft loan account (PRK), a time deposit, a JPY account). Today's parser merges them into one stream and fails continuity.

Buku today only accepts bank statements, uses one fixed 42-account template per client, and stores whole Rupiah in one currency.
The owner approved widening the input (**bank statements + ledgers + Neraca/TB**) and asked for **multi-currency** so the
whole Chickin group, HoldCo included, can be demoed.

Who feels it: the owner demoing Chickin; accountants whose clients keep books in Jurnal/Accurate/Excel or have foreign parents.
Outcome: upload Chickin's workbook → each company shows its TB in **its own accounts and currency** (HoldCo in SGD). The
Indonesian companies match the workbook. The group Gabungan shows all five in IDR with the translation difference visible.
The source checks catch the known problems. Goers' Neraca becomes Saldo Awal. The SMBC PDF imports per account.

Findings from exploring the files (drive the design):
- Chickin rows balance when grouped by **(entity, date)**. At sen precision only 4 of 48 Indonesian groups are off: CSP −5,000,000
  (31 Mar 2023) / +5,000,000 (31 Dec 2023), which is the consultant's known unbalanced batch, and CAH +0.79 / −1.13 (audit working-paper rounding).
  Rounding each line to whole Rupiah leaves 29 groups off by Rp 1–3, so rounding must be explicit.
- 1,125 of 3,437 rows carry sen, with float noise (`…0.000004`). Goers carries sen too (93,375,132.07).
- **HoldCo mixes currencies in one amount column.** USD amounts are posted against SGD lines using the same number
  (bank USD Dr 150,000 / loan payable "SGD" Cr 150,000). Month-end "Convert … @ 1.31" entries then add the SGD difference
  via 35000 FX gain/loss. **One IDR row of 1,174,593,356 sits in the SGD ledger** on 11002 Loan to Subsidiary, which is the amount
  of register item HCO-SKP-FND-006. Rate notes (`Rate: 1.31`, USD→SGD) are in the Notes column. There are no SGD→IDR rates in the file.
- Answer key: the workbook's TB tab has cached values for 1,515 of 1,632 Indonesian rows. **HoldCo's TB tab has none** (never
  recalculated), so HoldCo is checked against an independent recompute from its ledger plus the FS tab totals where cached.
- SMBC: every account section is continuous on its own (22 rows). The overdraft account's balance is legitimately negative.

## Spec
**A. Accounts: entity source accounts mapped to the client chart**
- [ ] New `SourceAccount` per entity: its own code + name as in the client's files, a type hint, a currency (for monetary
      foreign-currency accounts) and a mapping to one client `Account`. The client chart stays shared across entities, so the
      combined view keeps lining up (rules §9–11).
- [ ] Imported journal lines keep `sourceAccountId`. **Neraca Saldo** gets a view *Akun sumber*: each entity's TB in its own accounts
      and functional currency. That's the view that must match Chickin's TB tab and Goers' Neraca.
- [ ] Mapping target is an existing client account **or** *Buat akun baru*: a new client account under a chosen FS line with the next
      free code in that range. Special codes (1190/1199/1999/3200/1101–1109) are never created this way.

**B. Ledger / Neraca import (XLSX, CSV)**
- [ ] Reader detects the table by header names from content (tanggal/date · kode akun/account code · nama akun · debit/debet ·
      kredit/credit · keterangan/description · no bukti/voucher/ref · entitas/entity · mata uang/currency · kurs/rate), across all
      sheets. The user picks the sheet if more than one matches. Two modes: **Buku besar** (dated lines → journal entries) and
      **Neraca / Neraca Saldo** (one date, balances → the entity's `OPENING` entry).
- [ ] Rows group into entries by voucher/ref when present, else by **(entity, date)**. Each posted entry keeps `ledgerImportId` +
      `sourceRef` (`sheet!row` range), and each line keeps its row reference.
- [ ] Entity column values are mapped to the client's entities once per import (or one entity chosen for the whole file).
- [ ] Neraca mode: rows with code + amount are imported. Rows without a code are imported only if they aren't totals (Jurnal's
      "Current Period Earnings" → 3200). The file's own totals are checks, not postings.
- [ ] All-or-nothing in one transaction. The same file (content hash) can't be imported twice for the same entity. Locked periods refuse.

**C. Multi-currency**
- [ ] **Currency registry** (IDR, USD, SGD, JPY, EUR, AUD, CNY, HKD, MYR…) with minor-unit exponent (IDR 0, JPY 0, others 2).
- [ ] **Entity functional currency** (default IDR; chosen in Tambah klien, fixed once the entity has entries). Every journal line's
      `debit`/`credit` is **bigint minor units of the entity's functional currency**. For IDR entities that is whole Rupiah exactly as
      today, so existing data and the demo are unchanged.
- [ ] **Foreign-currency lines** keep `currency`, `fxAmount` (bigint minor units) and `fxRate` (decimal string, functional per 1 unit).
      `postJournal` checks `round(fxAmount × fxRate) = functional amount` (±1 minor unit).
- [ ] **Kurs page** (`/clients/[id]/rates`, firm-scoped `ExchangeRate`: currency, quote currency, date, rate, kind SPOT/AVERAGE, source
      MANUAL/FILE). Rates are entered by hand or picked up from the imported file (rate column or `Rate: 1.31`-style notes). No
      external rate feed.
- [ ] Ledger import currency handling, chosen per import: **"Jumlah sudah dalam mata uang fungsional"** (default: the amount
      column is posted as-is, the currency column is kept as information) or **"Jumlah dalam mata uang baris"** (converted with the
      row's rate, else the Kurs table for that date; missing rate = BLOCK naming currency + date).
- [ ] **Revaluation (month-end, deterministic):** for monetary foreign-currency accounts (flagged source accounts, foreign-currency bank
      accounts), Buku computes `fxBalance × closing rate − functional balance` and proposes one ADJUSTMENT entry to **7200 Laba/Rugi
      Selisih Kurs**. The accountant posts it with one click. New close control *Revaluasi kurs*: REVIEW if a foreign-currency balance
      exists and no revaluation was posted for the period.
- [ ] **Reports:** single-entity reports (TB, Laba Rugi, Neraca, ledger, drill-down) are in the entity's functional currency, with the
      currency shown in the header and `Money` formatting by currency. **Gabungan / combined worksheet and Beranda totals are in IDR**:
      non-IDR entities are translated with assets & liabilities at the closing rate, income & expenses at the period's average rate, and
      equity at the historical rate (rate on the entity's opening/first entry). The difference shows as a separate equity line
      **"Selisih penjabaran mata uang asing"**. The label still says management Gabungan, not SAK consolidation (rule 11). A missing rate
      shows the entity as *belum dijabarkan*, with a link to Kurs, instead of a wrong number.

**D. Source checks (deterministic, shown before posting, stored with the import)**
- [ ] BLOCK (can't post until fixed or explicitly accepted): an amount cell that isn't a number (`#VALUE!`, `#REF!`, `#NAME?`, `#ERROR!`,
      `#N/A`, text), a row without date/account, a group that doesn't balance at minor-unit precision, a currency not in the registry,
      a missing rate in convert mode. Accepting an unbalanced group posts the difference to **1999 Belum Terklasifikasi** with memo
      "Selisih dari file sumber", so *1999 kosong* stays REVIEW until someone fixes it with a Jurnal Penyesuaian.
- [ ] REVIEW: the same code with different names (code reused / chart migrated); a balance-sheet account whose closing sign is against
      its type hint; rows outside the chosen period; **line currency ≠ functional currency posted without a rate**; **a group that
      balances only in raw numbers across different currencies** ("kurs belum diterapkan"); **a line in a third currency** (e.g. IDR
      inside an SGD ledger).
- [ ] INFO: rows, groups, Σdebit/Σcredit per entity and currency, total rounding.
- [ ] Every check names the exact rows (`sheet!row`). The import summary lists them all, and the new close control *Impor buku besar*
      shows accepted BLOCK items as FAIL and REVIEW items as REVIEW for the affected period.

**E. Money with sen (IDR)**
- [ ] Amounts parse at 2-decimal precision (float noise rounded half-up first). For IDR entities each line rounds half-up to whole Rupiah.
      If the entry no longer balances, one line goes to new template account **7190 Selisih Pembulatan** (BEBAN_LAIN). The import
      summary shows total rounding. 2-decimal currencies (SGD, USD) need no rounding.

**F. AI in account mapping (input side)**
- [ ] Order: **same code+name already mapped in this client → exact/normalised name match → keyword rules (small table) → AI → none**.
- [ ] AI gets only account code, name, type hint and the client chart (no amounts, no descriptions). Batched ≤ 40 per call, cached forever in
      `AiSuggestion` (normalised name + type hint + coaVersion), whitelisted against the client chart, counted in the existing caps and `AiUsage`.
- [ ] **Nothing is applied without the accountant.** The mapping page shows suggestion + method + reason. *Terima semua saran* is an
      explicit click per method. Import can't post while any account is unmapped.

**G. SMBC combined statements + overdraft accounts**
- [ ] The PDF parser splits a statement into **account sections** by the section header ("Aktivitas Rekening … (<currency>) <number>"),
      each with its own opening/closing and continuity. `inspect:statement` prints one block per section.
- [ ] Import posts only IDR sections whose number matches a registered bank account of the entity. Others are listed as skipped with
      the reason (not registered / foreign currency / no activity).
- [ ] `BankCode` gains `SMBC` (detected from content). A bank account can be marked **Pinjaman rekening koran (PRK)**: its GL account is
      created in 2201–2209 (FS line *Utang bank*) and bank reconciliation works with negative balances.

**H. Onboarding**
- [ ] Tambah klien allows an entity without bank accounts and asks for the entity's functional currency (default IDR).

**I. Real-data verification + Chickin demo (local / `real-data` preview only, never in CI or the public demo)**
- [ ] `npm run verify:real -- chickin|goers|smbc` reads `data/private/`, imports into a fresh local client, and prints a PASS/diff table:
      Chickin Indonesian companies: per entity × year × source account, Buku closing vs the TB tab (cached values), plus BS/IS totals vs
      FS tabs. HoldCo: Buku SGD TB vs an independent recompute from its ledger, plus FS tab totals where cached. For both: which
      register problems the checks caught (target: CSP −5,000,000, SKP 2025 `#VALUE!`/APIC, IDR row in the SGD ledger, code reuse,
      CAH receivable with credit balance). Goers: Buku Neraca = file totals. SMBC: each section's continuity. Output goes to
      `data/private/reports/`.
- [ ] `docs/demo/chickin-demo.md`: a short private walk (import → checks → mapping → Akun sumber TB → HoldCo in SGD → Gabungan in
      IDR with translation difference → findings). Real numbers stay out of the repo; the doc references screens, not figures.

**Gate-reopeners (flagged):**
- **Schema migration (additive):** `Currency` seed data, `ExchangeRate`, `SourceAccount`, `LedgerImport`, `ImportCheck`;
  `Entity.functionalCurrency`; `JournalEntry.ledgerImportId/sourceRef`; `JournalLine.sourceAccountId/sourceRef/currency/fxAmount/fxRate`;
  `EntryKind.IMPORTED`; `BankCode.SMBC`; `BankAccount.isOverdraft/currency`; template accounts 7190, 7200 and the equity line for the translation difference.
- **Invariant changes** (accounting-rules + new ADR 0006, which updates ADR 0004's scope and ADR 0002's money rule):
  rule 6 "bigint Rupiah" → "bigint minor units of the entity's functional currency (IDR = whole Rupiah)"; rule 9 → client chart +
  per-entity source accounts; rule 11 → Gabungan translates non-IDR entities (closing / average / historical, difference in equity);
  rule 15 extended (ledger-derived entries carry `ledgerImportId` + `sourceRef`); rule 12 gains the ledger pipeline; new rules for
  IDR sen rounding (7190) and revaluation (7200, click-to-post, never automatic); `postJournal` merges by (account, source account, currency).
- **AI credit use:** new mapping requests (names only, cached, capped). Tests use `MockProvider`.
- No new dependency (`exceljs`, `unpdf` already in; decimal rate math done with bigint scaled integers, no decimal library).

**Non-goals:** intercompany reconciliation between separate companies (cycle 4), the full problem-finding engine and AI
review/commentary (cycle 3), Laba Rugi / Arus Kas import and monthly comparatives, each entity's own FS presentation (headings/order),
parent/child account hierarchy, AI column detection for unknown layouts, audit-adjustment layer (pre-audit vs audited), old→new
chart migration tables, editing/deleting imports, `.xls`, **foreign-currency bank-statement import** (the parser stays IDR; foreign
sections are listed as skipped), live rate feeds (BI/JISDOR API), SAK/PSAK 10 consolidation (NCI, goodwill, elimination of investment
vs equity), putting real data in tests, CI or the public demo.

**Assumptions:**
1. **Rounding goes to 7190 Selisih Pembulatan**, not to sen storage for IDR. IDR stays whole Rupiah; only 2-decimal currencies use cents.
2. **An unbalanced source group posts only after an explicit "Terima & catat selisih ke 1999"**, and stays REVIEW until fixed. The default is to block.
3. The Chickin test uses the consultant's rebuilt ledger (monthly/yearly totals per account), not the companies' original transactions (not in the folder).
4. If a source code shows up with different names across files/years, the latest name wins and a REVIEW check records the old name.
5. Indonesian answer key = the workbook's cached values. Rows without cached values, and all of HoldCo, are compared against an
   independent recompute from the ledger rows.
6. **HoldCo imports in "Jumlah sudah dalam mata uang fungsional" mode**, faithful to the source, so Buku's SGD TB equals what the
   consultant's ledger says. The checks then flag every USD/IDR line posted without a rate. Converting it "properly" would change the
   consultant's numbers and belongs in a cleanup, not an import.
7. **SGD→IDR and USD→IDR rates for Gabungan are entered on the Kurs page** (year-end spot and yearly average for 2023–2025). I'll
   prepare them from Bank Indonesia's published rates into `data/private/rates.csv` for the verify script and show the source. You confirm the numbers before the demo.
8. Revaluation is proposed, never auto-posted, and not run on Chickin's import (its ledger already contains the consultant's own
   revaluation entries). It's tested on synthetic data.
9. Chickin demo runs **locally or on the `real-data` preview** (behind Vercel login). An investor-facing version would need a
   synthetic look-alike, which isn't part of this cycle.

## Tasks
- [x] T1 ADR 0006 (input widening + multi-currency) + accounting-rules updates (rules 6, 9, 11, 12, 15, rounding, revaluation) — accept: docs reviewed; `CLAUDE.md` top-5 updated where rule 3 changes
- [x] T2 Migration: currency registry, ExchangeRate, SourceAccount, LedgerImport, ImportCheck, `Entity.functionalCurrency`, entry/line source + fx fields, EntryKind.IMPORTED, BankCode.SMBC, BankAccount.isOverdraft/currency, template 7190/7200/translation-difference line; `postJournal` accepts refs + fx fields, checks fx consistency, merges by (account, source account, currency) — accept: `prisma migrate dev` clean; DB tests; `npm run verify:books` ALL PASS (IDR demo unchanged) (dep: T1)
- [x] T3 Money: `lib/money.ts` currency-aware parse/format (minor units by exponent), IDR sen → Rupiah `roundEntry()` with 7190 line, bigint-scaled rate multiply — accept: unit tests: float noise, half-up, Σ preserved, JPY/IDR exponent 0, SGD 2
- [x] T4 `lib/ledger-import/read.ts`: XLSX/CSV → header detection across sheets (incl. currency/rate columns and `Rate:` notes) → rows with `sheet!row`; ledger + Neraca modes (reuse `xlsxToRows`, `readCsv`) — accept: unit tests on synthetic workbooks (Chickin-shaped multi-entity + multi-currency sheet; Jurnal-shaped Neraca with total rows)
- [x] T5 `lib/ledger-import/check.ts`: grouping + BLOCK/REVIEW/INFO checks with row refs, incl. currency checks — accept: unit tests reproduce −5,000,000 pair, `#VALUE!`, code-name reuse, credit-balance receivable, USD-vs-SGD same-number group, IDR line in SGD ledger (dep: T3, T4)
- [x] T6 `lib/ledger-import/mapping.ts`: prior mapping → name match → keyword rules → AI (batched, cached, whitelisted, capped; reuse `lib/ai`) + *Buat akun baru* — accept: DB tests with MockProvider; nothing applied without explicit accept (dep: T2)
- [x] T7 `lib/ledger-import/post.ts`: all-or-nothing posting via `postJournal` (IMPORTED / OPENING), both currency modes, 1999 for accepted imbalances, 7190 rounding, file-hash dedupe, locked-period refusal — accept: DB tests; TB = Σ source per source account per currency (dep: T2, T3, T5, T6)
- [x] T8 Rates: `lib/fx/rates.ts` (lookup spot/average by date, pick up rates from import) + Kurs page (load `ui-rules`) — accept: DB tests for lookup edge cases; browser: add/edit rate (dep: T2)
- [x] T9 Reports in functional currency + translation: `lib/reports` scope carries currency; single-entity reports in functional currency; combined worksheet / Beranda / monthly series translate non-IDR entities (closing / average / historical, difference line); *belum dijabarkan* when a rate is missing; `Money` by currency — accept: DB tests on a synthetic SGD entity (hand-computed translation difference); `npm run verify:books` ALL PASS (dep: T2, T3, T8)
- [x] T10 Revaluation: `lib/fx/revalue.ts` proposal + click-to-post ADJUSTMENT to 7200 + control *Revaluasi kurs* — accept: DB tests on synthetic USD account in an SGD entity (dep: T8, T9)
- [x] T11 Onboarding: entity without bank accounts + functional currency — accept: DB test + form accepts empty account list and SGD
- [x] T12 Controls: *Impor buku besar* (FAIL for accepted BLOCK, REVIEW for REVIEW), 7190 info — accept: DB test on a synthetic import (dep: T7)
- [x] T13 UI: Impor tab *Buku besar / Neraca* → check report → *Pemetaan akun* → post → summary; Saldo Awal *Impor dari Neraca*; Neraca Saldo *Akun sumber* with drill-down to `sheet!row`; currency shown on entity pages (load `ui-rules`) — accept: browser walk on synthetic files, screenshots (dep: T6, T7, T9, T11)
- [x] T14 SMBC: PDF section split, per-section continuity, `inspect:statement` per section, IDR sections matched to registered accounts, `SMBC` detection, PRK account in 2201–2209 — accept: unit test on a synthetic 3-section PDF fixture; local run on the real file prints 3 × NYAMBUNG ✓ (dep: T2)
- [x] T15 `scripts/verify-real.ts` (+ `npm run verify:real`), local only, reads/writes `data/private/` — accept: Chickin table per entity incl. HoldCo in SGD and Gabungan in IDR; register problems listed caught/missed; Goers Neraca totals equal; SMBC 3 sections ✓ (dep: T7, T9, T14)
- [x] T16 e2e: synthetic multi-currency ledger walk (upload → checks → map → post → Akun sumber TB → Gabungan with translation line); investor demo walk still green — accept: `npm run test:e2e` (dep: T13)
- [ ] T17 Docs: `docs/real-data.md` ledger/Neraca/Kurs section + SMBC note, `docs/demo/chickin-demo.md`, README feature table — accept: runbook steps match the UI

## Implementation
- Plan: tasks T1–T17 sequential, done inline (one driver keeps the invariants consistent across schema, money, reports and import; no subagents requested).
- Deviation: the currency registry lives in code (`lib/fx/currency.ts`), not a DB table — test/demo resets TRUNCATE every table, and codes are stored as strings (`Entity.functionalCurrency`, `JournalLine.currency`, `ExchangeRate.currency`).
- T1: `docs/adrs/0006-ledger-input-and-multicurrency.md`, `.claude/skills/accounting-rules/SKILL.md` (rules 6/6a/6b, 9/9a, 11, 15/15a, 17, 22), `CLAUDE.md` top-5 #3/#5.
- T2: `prisma/schema.prisma` + migration `20260924094628_ledger_import_multicurrency` (SourceAccount, LedgerImport, ImportCheck, ExchangeRate, entry/line refs + fx fields, `JournalLine_fx_check`, 3900/7190/7200 backfilled for existing clients); `lib/fx/currency.ts` (registry, exact bigint rate math); `lib/ledger/post.ts` (source-account ownership, fx consistency ±1 minor unit, refs); `lib/coa/template.ts` (3900/7190/7200, `SELISIH_PENJABARAN`, `overdraftAccountCode`); Neraca equity includes the translation line. `postJournal` never merged lines, so no merge-key change was needed.- T3: `lib/money.ts` — `parseCents` (strings + spreadsheet floats, noise → sen, rejects `#VALUE!`/text), `centsToMinor`, `parseMinor`, `roundEntry` (rounded lines + one 7190 residue, unbalanced total reported separately), `formatMoney` (IDR delegates to `formatRupiah`).
- T4: `lib/ledger-import/{types,read}.ts` — XLSX (all sheets, formula results, Excel error cells kept as errors) and CSV; header detection (ledger: date+account+debit/credit; Neraca: account+amount); Jurnal Neraca detected by shape (date header + coded rows), section-aware signs, uncoded equity rows (`NC:` codes), totals kept as checks; `Rate: 1.31` notes picked up. On the real files (local only): Chickin → `10_HC_GL_MASTER` 1,027 rows, `20_OPCO_GL_MASTER` 3,437 rows, 0 read errors, plus `04_HC_2022_FOUNDATION` as a Neraca (HoldCo opening); Goers → 23 accounts + 1 uncoded equity row, Total Assets = Total L&E = 61,506,778,900.88.
- T5: `lib/ledger-import/check.ts` — `planLedger` / `planNeraca` build the exact posting plan (groups by voucher or entity+date, sen → minor units, 7190 residue, CONVERT mode with row rate → rate table → BLOCK) and the checks: BLOCK `ROW_ERROR`, `UNKNOWN_ENTITY`, `UNKNOWN_CURRENCY`, `MISSING_RATE`, `UNBALANCED` (acceptable); REVIEW `CODE_RENAMED` (names normalised for case/spacing/dashes), `FX_SAME_NUMBER`, `FX_NO_RATE` (per entity × currency, with total + largest row), `SIGN_AGAINST_TYPE` (year-end, balance-sheet accounts only, "Piutang" ≠ "utang"), `TOTAL_MISMATCH`; INFO `STATS`, `TOTAL_OK`. On the real Chickin ledgers (local): CSP ±Rp 5.000.000 (31 Mar / 31 Des 2023), CAH ±Rp 1 (WP rounding), HoldCo ±S$ 400 (14/15 May 2025 — not in the consultant's register), 2 IDR rows (Rp 2,349,186,712) + 749 USD rows posted without rate in the SGD ledger, 19 same-number USD/SGD groups, 98 code renames incl. 21001 / 21002 / 23006 (register FND-018), 5 sign anomalies. CAH 12311 closes at 0 in the rebuilt ledger, so it's correctly not flagged (consultant closed it with no GL action).
- T6: `lib/ledger-import/mapping.ts` — `inferType` (name before code: HoldCo 41000 is an expense), ~55 keyword rules → template codes with type guards, `deterministicSuggestion` (prior → exact name → keyword), `suggestMappings` (fills `suggested*` only; AI for leftovers, one question per unique name+type, ≤40/call, capped, cached in new `AiAccountMap`, codes whitelisted even if the provider doesn't), `acceptMappings` (explicit; refuses bank/suspense/clearing), `createClientAccount` (next free code per FS line, special codes skipped, bumps `coaVersion`). `AiProvider.mapAccounts` (names/type only). Migration `account_mapping`: `SourceAccount.suggestedCode/suggestedBy`, `AiAccountMap`, 11 generic template accounts (1120 Kas di Bank, 1140, 1180, 1250, 1260, 2120, 2145, 2160, 2300, 2310, 3110) + FS lines `ASET_TIDAK_LANCAR_LAIN`, `UTANG_JANGKA_PANJANG`, backfilled for existing clients. Neraca groups are now derived from FS-line sections, so no account can silently fall out of the balance sheet. Deviation: AI mapping answers cache in `AiAccountMap`, not `AiSuggestion` (that key carries a bank direction). `data/` excluded from ESLint/tsc (local scratch only). Rules alone map 689/705 real Chickin accounts and 23/23 Goers accounts; the rest go to AI.
- T7: `lib/ledger-import/post.ts` — `stageImport` (sheet choice, sheet-level file-hash dedupe, entity labels auto-paired by short/full name, CONVERT mode uses the rate table, source accounts created/renamed with earlier names kept, DRAFT with the exact plan + checks; Neraca refused at upload if the entity already has an opening), `acceptCheck` (only UNBALANCED), `importSourceAccounts`, `postImport` (all-or-nothing, refuses unaccepted BLOCK / unmapped accounts / duplicate sheet / existing opening / locked period; IMPORTED or OPENING entries with `ledgerImportId` + `sheet!rows`, lines with source account + row ref + fx, 7190 residue, 1999 for accepted differences, all-zero groups skipped and counted in STATS). `lib/fx/rates.ts` (lookup incl. inverse pair, upsert). Real Chickin on the local DB (scratch, not committed): OpCo sheet staged 48 entries / 691 accounts in 2.2 s, rules mapped 675, posted in 1.5 s; HoldCo 168 groups (3 all-zero reval groups skipped) posted in 2.5 s; 3,963 lines total.
- T8: `lib/fx/rates.ts` — `lookupRate` (latest ≤ date, inverse pair), translation rules `closingRate` (SPOT in the same month — no stale rates), `averageRate` (first AVERAGE on/after period end in the same year; a yearly average dated 31 Dec covers every month), `rateNeeds` (historical + each year-end spot + each year's average for non-IDR entities), `upsertFileRate` (file rates never overwrite MANUAL), `validateRateInput`; `normalizeRateInput` / `formatRateId` in `lib/fx/currency.ts` ("12.250,50" → 12250.5, displayed without floats). Ledger import keeps rates written in the file and saves them on post (source FILE, note = file + row). Kurs page `/clients/[id]/rates` (needs table, form with one-click fill for missing rates and a live "Dibaca sebagai" preview, rate list with source + delete), `saveRateAction` / `deleteRateAction`, sidebar "Kurs". Dev preview: the app's preview launcher can't start `npm run dev` in this folder (`EPERM uv_cwd`, macOS folder permission), so the dev server ran from the shell and the built-in browser was pointed at localhost.
- T9: `lib/reports/fx.ts` (scope currency, per-entity closing/average/historical rates, `translateNets` with the residue on 3900, `FxMissingError`); `lib/reports/ledger.ts` — `trialBalance`, `incomeStatement`, `combinedWorksheet` (`translated` flag), `monthlySeries` keep their signatures: one-currency scopes are unchanged, mixed scopes are translated to IDR or throw `FxMissingError`; cash series now counts every *Kas dan setara kas* account (ledger clients have no bank GL). Pages: `loadClientPage` returns the scope currency; `Money` / `FsTable` / `LedgerTable` / charts format by currency; reports, Neraca Saldo, Buku Besar and Ringkasan show a *belum dijabarkan* banner (with the missing rates and a link to Kurs) instead of numbers; the Neraca comparison column drops out (labelled) when last month can't be translated, so it never blocks the current period; the account ledger asks for one entity when the scope mixes currencies; imported lines show their file row, the client's own account and the fx amount in the drill-down sheet. Controls format by entity currency and add *Kurs penjabaran ke Rupiah lengkap* (REVIEW) when Gabungan can't be translated. Tax card counts IDR entities only. Kurs page also lists the selected period's closing + average rate.
- T10: `lib/fx/revalue.ts` — `revaluationProposals` per (entity, balance-sheet account, currency): foreign balance × same-month closing rate vs carried functional balance (income/expense never revalued), missing rates listed; `postRevaluation` posts one ADJUSTMENT per entity on click, revaluation lines keep the currency with fx amount 0 and the closing rate, the net goes to 7200. `postJournal` accepts `fx.revaluation` lines only with fx amount 0. Control *Revaluasi kurs saldo valas* (REVIEW until posted or rates filled). Tutup Buku shows a *Revaluasi kurs* card per entity with the proposal table and a "Catat revaluasi" button; `revaluationAction`.
- T11: `lib/onboarding.ts` / `lib/setup.ts` — entity currency (validated against the registry, default IDR), bank accounts optional; `components/app/client-form.tsx` — *Mata uang pembukuan* select per entity, the last bank row can be removed ("Tanpa rekening bank. Buku entitas ini diisi dari file buku besar atau neraca."), ledger-only clients land on Impor after saving; copy updated on Tambah klien.
- T12: `lib/controls/index.ts` — one *Impor buku besar/neraca <sheet>* control per posted import overlapping the period: FAIL while an accepted source difference is still in the entity's 1999 (clears after a Jurnal Penyesuaian), REVIEW for REVIEW findings dated in the period (undated ones in the import's last month), 7190 rounding in the detail; links to the import page; acknowledgeable like other REVIEW controls.
- T13: Impor page gets *Rekening koran | Buku besar / neraca* tabs (ledger-only clients see only the ledger part, titled *Impor Buku Besar*) with `LedgerImportForm` (file, sheet choice when several tables match, entity or "sesuai kolom entitas", currency mode, optional Neraca date) and an import history. New page `/clients/[id]/import/ledger/[importId]`: NextStep, stats, *1. Pemeriksaan file* (BLOCK → REVIEW → INFO, row refs, "Terima & catat selisih ke 1999"), *2. Pemetaan akun* (`MappingPanel`: rule suggestions pre-filled right after upload, bulk accept per method, "Minta saran AI" only on click, per-row accept/change, "+ Buat akun baru" with the FS line defaulted from the account type, low-confidence AI called out), *3. Catat ke buku* (post / discard draft). Actions: `stageLedgerAction`, `acceptCheckAction`, `suggestMappingsAction`, `acceptMappingsAction`, `postLedgerImportAction`, `discardLedgerDraftAction`. Neraca Saldo gets *Bagan akun Buku | Akun sumber* (`lib/reports/source.ts`: the entity's TB in its own codes, mapped Buku account under each, prior-year result as one row). Saldo Awal links to Neraca import and no longer asks for an opening when the ledger import brought one; Ringkasan too. Period picker includes months with imported/adjustment journals (`lib/periods.ts`). Layout: `SidebarInset` gets `min-w-0` so wide tables scroll inside their card instead of widening the page. MethodBadge knows mapping methods.
- T14: `lib/import/parsers/pdf.ts` — `parsePdfSections` splits combined statements at "Aktivitas Rekening / Account Activities … (<CCY>) <number>" (any separator), parses each section on its own (label, currency, opening, continuity; empty sections allowed when they have an opening row), month-name period ranges ("01 MEI 2026 - 31 MEI 2026"), posting-date column dropped from descriptions, `SMBC` format detection. `parseStatementSections` in `lib/import/parsers`; `importStatement` picks the section matching the bank account (digits only), refuses foreign-currency sections and files without the account (listing what's inside), and reports `otherSections` (shown on the import result). `inspect:statement` prints every section. Onboarding: bank *SMBC / Jenius* and a *PRK* checkbox; PRK accounts get GL 2201–2209 (LIABILITAS, Utang bank) and reconcile with negative statement balances. Cash series counts *Kas dan setara kas* only (not the PRK liability).
- T15: `scripts/verify-real.ts` (`npm run verify:real -- chickin|goers|smbc|all [--into-app]`, local only, report to `data/private/reports/`): Chickin → client with SKP/CSP/CAH/SPN (IDR) + HOLDCO (SGD), rates from `data/private/rates.csv`, imports `04_HC_2022_FOUNDATION` (HoldCo opening 31 Dec 2022) + both GL sheets (unbalanced groups accepted, rules for mapping, no AI; unrecognised accounts fall back by type), compares every entity × source account × year with an independent recompute of the ledger rows (plain ExcelJS, not Buku's reader), prints each entity's Neraca per year-end, the IDR Gabungan, and which register findings the checks caught. Goers → Neraca as opening, file totals vs Buku. SMBC → sections + continuity. **Spec deviation (assumption 5):** the workbook's TB/FS tabs contain formulas with no saved values (never recalculated; no Excel/LibreOffice here), so the answer key is the independent recompute of the same ledger — which is what those formulas compute. `data/private/rates.csv`: SGD→IDR month-end spot Dec 2022–Dec 2025 + yearly averages 2023–2025 from ECB reference rates via api.frankfurter.dev (source per row), to be confirmed by the owner before the demo.
- T16: `e2e/ledger-import.spec.ts` — Tambah klien (IDR company + SGD holding, both without bank accounts) → generated multi-entity ledger → checks (−Rp 5.000.000 group accepted) → 6 rule suggestions + one *Buat akun baru* → post → Kurs page fills the 3 missing SGD→IDR rates → Gabungan worksheet shows *Selisih Penjabaran Mata Uang Asing*, Neraca *Seimbang* → Neraca Saldo · Akun sumber for the SGD entity. Fix found by the test: the Kurs form labels weren't linked to their inputs (`htmlFor`/`id`).

## Verification
- T2: `npm test` → Test Files 14 passed, Tests 67 passed. `verify:books` on a freshly reset demo → `ALL PASS — 1069 pemeriksaan saldo cocok dengan ground truth.` (The first run failed 13 checks on a stale local DB edited by hand earlier; `demo:reset` fixed it — not caused by this change.)- T3: `npm test` → Test Files 14 passed, Tests 74 passed.
- T4: `npm test` → Test Files 15 passed, Tests 79 passed.
- T5: `npm test` → Test Files 16 passed, Tests 88 passed.
- T6: `npm test` → Test Files 17 passed, Tests 93 passed. `verify:books` (fresh demo) → `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`
- T7: `npm test` → Test Files 18 passed, Tests 98 passed.
- T8: `npm test` → Test Files 19 passed, Tests 104 passed. Browser (local, synthetic SGD group): Kurs page lists 3 missing SGD→IDR rates; typing `11.850,25` previews "1 SGD = 11.850,25 IDR", saves as Manual, the historical need flips to *Ada*; no console errors.
- T9: `npm test` → Test Files 20 passed, Tests 109 passed; `verify:books` → `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.` Browser (synthetic SGD group, local): combined Neraca Dec 2025 = Kas 6.075.600 (S$488 × 12.450), Modal 5.925.125 (S$500 × 11.850,25 historical), laba rugi −147.600 (S$12 × 12.300 average), selisih penjabaran 298.075, *Seimbang*; worksheet in IDR; HoldCo Neraca Saldo "dalam SGD" (488.000,00 / 500.000,00 / 12.000,00); missing rates show the banner; demo Grup Ayam Nusantara Neraca unchanged; no console errors.
- T10: `npm test` → Test Files 21 passed, Tests 112 passed; `verify:books` → ALL PASS (1333). Browser (synthetic SGD group + USD 10,000 loan at 1.32, closing 1.29): card shows bank (300,00) / loan 300,00; *Catat revaluasi Contoh Pte* posts, card says no difference left, control turns *Lolos*.
- T11: `npm test` → Test Files 21 passed, Tests 113 passed. Browser: Tambah klien shows the currency select and a removable bank row.
- T12: `npm test` → Test Files 22 passed, Tests 114 passed; `verify:books` ALL PASS (1333).
- T13: `npm test` → Test Files 22 passed, Tests 114 passed; `verify:books` ALL PASS (1333). Browser walk (local, synthetic 2-entity ledger, IDR + SGD, staged by script because the built-in browser can't pick files — the upload form is covered by e2e in T16): checks list the Rp 5.000.000 and S$ 400 unbalanced groups, the reused code 21001, USD/SGD same-number group, USD and IDR rows without rate; both differences accepted → *Diterima ke 1999*; 12 rule suggestions accepted in one click; Gofood mapped via *Buat akun baru* (defaults to Beban umum & administrasi); *Catat 8 jurnal* → *Tercatat*; Neraca Saldo · Akun sumber for DUA (SGD) shows file codes with their Buku account, 1999 row, *Seimbang*; ledger drill-down shows `GL_MASTER!14`, entry rows 14–15, the file account and "USD dicatat apa adanya"; Ringkasan shows one NextStep plus a quiet card for missing rates; no console errors.
- T14: `npm test` → Test Files 23 passed, Tests 117 passed; `verify:books` ALL PASS (1333). Real SMBC Touchbiz May 2026 (local, `inspect:statement`): 3 sections — Jenius Main Account, GIRO KARYA, Pinjaman Rekening Koran BTB — all `NYAMBUNG ✓`, period 2026-05-01 s.d. 2026-05-31.
- T15: `npm run verify:real` (local, real files) → `✓ Semua pemeriksaan lolos`. Chickin: CAH 138 / CSP 358 / HOLDCO 37 / SKP 566 / SPN 86 balances compared, 0 mismatches (804 exact, 381 sen-rounding only); every entity's Neraca balances 2023–2025; HoldCo 2023 total assets S$ 7.136.663,22 = the consultant's gate note in the workbook; Gabungan IDR balanced 2023/2024/2025 with translation differences Rp 936.208.097 / 6.378.650.008 / 25.416.704.056; register findings caught: CSP ±Rp 5.000.000, IDR rows in the SGD ledger (FND-006), SKP code reuse 21001/21002 (FND-018), USD rows without rate, CAH ±Rp 1; not in this workbook: SKP 2025 `#VALUE!`; new: HoldCo ±S$ 400 (14/15 May 2025). Goers: Total Assets = Total L&E = Rp 61.506.778.901, Buku Neraca seimbang. SMBC: 3 sections NYAMBUNG. `npm test` → 23 files, 117 tests passed.
- T16: `npm run build` ✓; `npm run test:e2e` → 3 passed (investor-demo, ledger-import, real-client).

## Ship Notes

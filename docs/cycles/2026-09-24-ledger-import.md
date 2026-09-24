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
- [ ] T4 `lib/ledger-import/read.ts`: XLSX/CSV → header detection across sheets (incl. currency/rate columns and `Rate:` notes) → rows with `sheet!row`; ledger + Neraca modes (reuse `xlsxToRows`, `readCsv`) — accept: unit tests on synthetic workbooks (Chickin-shaped multi-entity + multi-currency sheet; Jurnal-shaped Neraca with total rows)
- [ ] T5 `lib/ledger-import/check.ts`: grouping + BLOCK/REVIEW/INFO checks with row refs, incl. currency checks — accept: unit tests reproduce −5,000,000 pair, `#VALUE!`, code-name reuse, credit-balance receivable, USD-vs-SGD same-number group, IDR line in SGD ledger (dep: T3, T4)
- [ ] T6 `lib/ledger-import/mapping.ts`: prior mapping → name match → keyword rules → AI (batched, cached, whitelisted, capped; reuse `lib/ai`) + *Buat akun baru* — accept: DB tests with MockProvider; nothing applied without explicit accept (dep: T2)
- [ ] T7 `lib/ledger-import/post.ts`: all-or-nothing posting via `postJournal` (IMPORTED / OPENING), both currency modes, 1999 for accepted imbalances, 7190 rounding, file-hash dedupe, locked-period refusal — accept: DB tests; TB = Σ source per source account per currency (dep: T2, T3, T5, T6)
- [ ] T8 Rates: `lib/fx/rates.ts` (lookup spot/average by date, pick up rates from import) + Kurs page (load `ui-rules`) — accept: DB tests for lookup edge cases; browser: add/edit rate (dep: T2)
- [ ] T9 Reports in functional currency + translation: `lib/reports` scope carries currency; single-entity reports in functional currency; combined worksheet / Beranda / monthly series translate non-IDR entities (closing / average / historical, difference line); *belum dijabarkan* when a rate is missing; `Money` by currency — accept: DB tests on a synthetic SGD entity (hand-computed translation difference); `npm run verify:books` ALL PASS (dep: T2, T3, T8)
- [ ] T10 Revaluation: `lib/fx/revalue.ts` proposal + click-to-post ADJUSTMENT to 7200 + control *Revaluasi kurs* — accept: DB tests on synthetic USD account in an SGD entity (dep: T8, T9)
- [ ] T11 Onboarding: entity without bank accounts + functional currency — accept: DB test + form accepts empty account list and SGD
- [ ] T12 Controls: *Impor buku besar* (FAIL for accepted BLOCK, REVIEW for REVIEW), 7190 info — accept: DB test on a synthetic import (dep: T7)
- [ ] T13 UI: Impor tab *Buku besar / Neraca* → check report → *Pemetaan akun* → post → summary; Saldo Awal *Impor dari Neraca*; Neraca Saldo *Akun sumber* with drill-down to `sheet!row`; currency shown on entity pages (load `ui-rules`) — accept: browser walk on synthetic files, screenshots (dep: T6, T7, T9, T11)
- [ ] T14 SMBC: PDF section split, per-section continuity, `inspect:statement` per section, IDR sections matched to registered accounts, `SMBC` detection, PRK account in 2201–2209 — accept: unit test on a synthetic 3-section PDF fixture; local run on the real file prints 3 × NYAMBUNG ✓ (dep: T2)
- [ ] T15 `scripts/verify-real.ts` (+ `npm run verify:real`), local only, reads/writes `data/private/` — accept: Chickin table per entity incl. HoldCo in SGD and Gabungan in IDR; register problems listed caught/missed; Goers Neraca totals equal; SMBC 3 sections ✓ (dep: T7, T9, T14)
- [ ] T16 e2e: synthetic multi-currency ledger walk (upload → checks → map → post → Akun sumber TB → Gabungan with translation line); investor demo walk still green — accept: `npm run test:e2e` (dep: T13)
- [ ] T17 Docs: `docs/real-data.md` ledger/Neraca/Kurs section + SMBC note, `docs/demo/chickin-demo.md`, README feature table — accept: runbook steps match the UI

## Implementation
- Plan: tasks T1–T17 sequential, done inline (one driver keeps the invariants consistent across schema, money, reports and import; no subagents requested).
- Deviation: the currency registry lives in code (`lib/fx/currency.ts`), not a DB table — test/demo resets TRUNCATE every table, and codes are stored as strings (`Entity.functionalCurrency`, `JournalLine.currency`, `ExchangeRate.currency`).
- T1: `docs/adrs/0006-ledger-input-and-multicurrency.md`, `.claude/skills/accounting-rules/SKILL.md` (rules 6/6a/6b, 9/9a, 11, 15/15a, 17, 22), `CLAUDE.md` top-5 #3/#5.
- T2: `prisma/schema.prisma` + migration `20260924094628_ledger_import_multicurrency` (SourceAccount, LedgerImport, ImportCheck, ExchangeRate, entry/line refs + fx fields, `JournalLine_fx_check`, 3900/7190/7200 backfilled for existing clients); `lib/fx/currency.ts` (registry, exact bigint rate math); `lib/ledger/post.ts` (source-account ownership, fx consistency ±1 minor unit, refs); `lib/coa/template.ts` (3900/7190/7200, `SELISIH_PENJABARAN`, `overdraftAccountCode`); Neraca equity includes the translation line. `postJournal` never merged lines, so no merge-key change was needed.- T3: `lib/money.ts` — `parseCents` (strings + spreadsheet floats, noise → sen, rejects `#VALUE!`/text), `centsToMinor`, `parseMinor`, `roundEntry` (rounded lines + one 7190 residue, unbalanced total reported separately), `formatMoney` (IDR delegates to `formatRupiah`).

## Verification
- T2: `npm test` → Test Files 14 passed, Tests 67 passed. `verify:books` on a freshly reset demo → `ALL PASS — 1069 pemeriksaan saldo cocok dengan ground truth.` (The first run failed 13 checks on a stale local DB edited by hand earlier; `demo:reset` fixed it — not caused by this change.)- T3: `npm test` → Test Files 14 passed, Tests 74 passed.

## Ship Notes

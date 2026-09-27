# Client COA-first general ledger

## Context
The real-file hard test (private scorecard, finding H5) showed that Buku posts real ledgers faithfully (Chickin: every
account × month balance ties to the file) but shows the accountant *Buku's* chart, not the client's: 707 client accounts
collapse into 47 Buku accounts, 15% into catch-alls (6190 alone holds 106), and Goers' long-term payables are presented as
current. The accountant thinks in the client's own accounts — that is what the client's Jurnal/Accurate/Excel shows and
what the auditor asks about. Rillet-style: the ledger is the system of record, and every number opens down to its source.

The data model already supports this: every imported line keeps `sourceAccountId` (ADR 0006 decision 2), and a
source-account TB exists as a secondary tab with closing balances only. Missing: a ledger per client account,
client accounts as the default entity view, movement columns, report drill into client accounts, a current / non-current
liability split, and section headings used when mapping a Neraca.

Outcome: for a single entity with a posted ledger or Neraca, Buku Besar, Neraca Saldo and the Laporan Keuangan drill
show the client's own accounts first; the Buku chart stays the classification and consolidation layer (Gabungan).

## Spec
Views (entity scope with ≥ 1 source account → client accounts by default; `?view=buku` switches; multi-entity / Gabungan
stay on the Buku chart because each entity has its own accounts)
- [ ] **Buku Besar · Akun klien**: client accounts grouped by type, code + name as in the file, lines this month, closing
      balance, and the Buku account it maps to as secondary text. Lines without a client account (bank lines,
      adjustments, 1999, 7190) are listed under their Buku account, marked *tanpa akun klien* (same rule as the source TB).
- [ ] **Ledger of one client account** `/clients/[id]/ledger/akun/[sourceAccountId]`: opening balance, lines of the month,
      running balance, each line opening its journal and source (`sheet!row`, bank row) — reuse `LedgerTable`.
- [ ] **Neraca Saldo**: tabs *Akun klien* (default per the rule above) / *Bagan akun Buku*; both gain movement columns
      *Saldo awal · Debit · Kredit · Saldo akhir* for the month; rows link to their ledger; totals balance.
- [ ] **Laporan Keuangan drill**: under each FS line, the breakdown lists the client accounts behind each Buku account
      (single entity), linking to their ledgers. Totals unchanged.
- [ ] **Neraca: Liabilitas jangka pendek / jangka panjang** as separate sections with subtotals (SAK EP presentation).
      `UTANG_JANGKA_PANJANG` (2300, 2310) is non-current, the rest current. Totals unchanged.

Mapping
- [ ] Neraca reader records a **term** from sub-headings (*jangka panjang / long-term / non-current / tidak lancar* vs
      *lancar / current / jangka pendek*) on each row; staging stores it on `SourceAccount.termHint` (`CURRENT` |
      `NON_CURRENT` | null).
- [ ] Deterministic mapping: a LIABILITAS source with `NON_CURRENT` and no more specific keyword → 2300; an ASET source
      with `NON_CURRENT` and no fixed-asset / intangible / investment keyword → 1260. Existing keyword rules keep priority.
      Goers' *Others Payables-Related Parties* (Long-term section) is suggested 2300, not 2120.

Verification
- [ ] `scripts/verify-real.ts` ties out Chickin per entity × client account × **month** × currency (from the hard-test
      harness, independent ExcelJS reader), and checks Goers' long-term accounts land in *Liabilitas jangka panjang*.
- [ ] Unit/DB tests for movement TB, client-account ledger, FS source breakdown, liability split, term hint → mapping.
      `verify:books` ALL PASS (demo has no source accounts, numbers unchanged); e2e ledger-import walk updated to the
      new tab names and one click into a client-account ledger.

**Gate-reopeners:** **schema migration** — one nullable column `SourceAccount.termHint` (enum `AccountTerm`). No new
dependency, no AI, no accounting-invariant change (presentation + a mapping *suggestion*; posting unchanged).

**Non-goals:** replacing the client chart with per-entity charts (ADR 0006 keeps one shared client chart for the
Gabungan); Gabungan in client accounts; editing / renaming client accounts in Buku; hierarchy beyond Neraca headings (GL
files carry none); suggesting new Buku accounts instead of catch-alls (next cycle); an in-product tie-out badge (Buku's
client-account balances are built from the same rows, so it would always match — the independent tie-out lives in
`verify-real`); re-mapping already-posted clients (accountant can still change a mapping; re-posting is out of scope).

**Assumptions:**
1. "Client COA first" applies where a client chart exists (ledger/Neraca imports). Bank-statement-only clients keep the
   Buku chart, which *is* their chart.
2. Default view is by data, not a setting: single entity + source accounts → client accounts. A toggle stays one click away.
3. Current vs non-current is a presentation split of the existing liability lines; 2300/2310 are the only non-current ones.
4. A term hint only changes *suggestions*; accepted mappings are never altered automatically (rule 9a).
5. Existing Goers/Chickin clients in production keep their mappings; the accountant can re-map or re-import.

## Tasks
- [x] T1 Report layer: movement TB for Buku and client accounts, client-account ledger query, FS breakdown by client account, liability split in `FS_LINES`/`balanceSheet` — accept: DB tests; `verify:books` ALL PASS. Reuse `trialBalance`, `sourceTrialBalance` (`lib/reports/source.ts`), `sumByAccount`.
- [ ] T2 Pages: Buku Besar tabs + client-account ledger page, Neraca Saldo tabs + movement columns, Laporan Keuangan drill, Neraca liability sections — accept: typecheck; browser check on local real Chickin/Goers at desktop + 390 px; e2e updated and green. Depends T1. Reuse `LedgerTable`, `FsTable`, `loadClientPage`.
- [ ] T3 Term hint: reader sub-headings, migration `SourceAccount.termHint`, staging, mapping rule — accept: unit test on a Jurnal-style Neraca fixture (Long-term payable → 2300); migration applies on a fresh DB.
- [ ] T4 `verify-real` monthly tie-out + Goers term check, run on local real files; end-of-cycle gates — accept: `verify:real` Chickin 0 mismatches monthly, Goers long-term in the right section; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline (reports → pages → mapping hint → real-data verification).
- T1: `lib/coa/template.ts` (liability FS lines in `LIABILITAS_JANGKA_PENDEK` / `LIABILITAS_JANGKA_PANJANG`), `lib/ledger-import/mapping.ts` (section → type for new accounts), `lib/reports/ledger.ts` (`trialBalanceMovement`: opening = closing − movement, single currency; `balanceSheet` adds `currentLiabilities` / `nonCurrentLiabilities`, `liabilities` stays their union, intercompany credit is current), `lib/reports/source.ts` (source TB with opening / month debit / credit / line count and link ids; `clientAccountsByAccount` for the report drill), `lib/reports/account-ledger.ts` (one ledger builder for a Buku account or a client account; the Buku ledger page now uses it), `tests/db/client-coa.test.ts`.
## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 52 passed (52), Tests 392 passed (392); `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
## Ship Notes

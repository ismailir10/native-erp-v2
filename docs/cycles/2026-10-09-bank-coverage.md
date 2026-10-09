# Bank coverage: more Indonesian banks than any local competitor, and MT940

## Context
The decks say Buku reads "BCA, Mandiri, BRI, SMBC". The owner wants Buku to read more banks than Zahir or any Indonesian
competitor and to be *the* product that is good at bank statements: the first file an accountant drops in decides whether they
trust it.

**What competitors do** (research 2026-10-09, sources in the session report; nobody reads PDF or MT940):

| Product | Bank-specific file import | Live feed | Formats |
|---|---|---|---|
| Accurate Online | 16 channels / 9 banks: BCA (personal, bisnis, API), Mandiri (internet bisnis, MCM), OCBC, BRI (CMS, IBBIZ, BRImo), BNI, Permata, UOB (2), Danamon, Maybank | KlikBCA personal, BCA API | CSV/XLS + own template |
| Mekari Jurnal | 7 banks: BCA (2), Mandiri (3), BRI, BNI, Danamon, OCBC NISP | BCA, CIMB, BNI, Mandiri, Danamon | CSV, XLS (Mandiri) |
| Kledo | BCA only, else own CSV template | BCA bisnis | CSV |
| Zahir | none — own CSV template | not found | CSV |

**Where Buku stands** (`lib/import/parsers/`): a strong layout-agnostic reader (header synonyms, D/K columns, month-name and serial
dates, newest-first, year-less dates, workbooks, combined PDFs) and a running-balance repair that makes misreads fail loudly. But:
- **Bank identity stops at 5 values** (`BankCode`: BCA, MANDIRI, BRI, SMBC, GENERIC). BNI, BSI, CIMB … are "Bank lain" in the
  client form, the import history and the reports; detection can't name them.
- **No MT940.** BCA, Mandiri, BRI, CIMB, Maybank, UOB, OCBC, DBS, HSBC and Bank Jatim offer it to business clients — one parser covers
  them all, and Maybank/DBS forward other banks' accounts in it.
- **Documented layouts that fail today** (public parser code and fixtures, confidence H):
  - KlikBCA Bisnis CSV as exported now: full `dd/mm/yyyy` dates, 5 columns, the direction as a suffix in the amount cell
    (`"3,528,964.00 CR"`). The BCA reader misreads the columns and the generic fallback can't parse `… CR` → the file is refused.
  - KlikBCA Individual CSV: `Account No.,=,'0123…`, unquoted descriptions with commas, `Starting Balance,=,` trailer.
  - Mandiri Livin' e-statement PDF: a row-number column before the date, bilingual headers (`Nominal/Amount`, `Saldo/Balance`), signed
    `-350.760,00`; Mandiri savings PDF with a `D` suffix; MCM/Kopra statement with `Posting Date | Remark | Debit | Credit | Balance`.
  - BNI: `Db.`/`Cr.` marker column (old savings PDF); corporate PDF `Posting Date | Effective Date | Branch | Journal | Transaction
    Description | Amount | DB/CR | Balance` with `D`/`K`; wondr PDF with `+3,497,000`.
  - Bank Jago (`Tanggal & Waktu | Sumber/Tujuan | Rincian Transaksi | Catatan | Jumlah | Saldo`, pocket sections), SeaBank
    (`DD MON` without a year, whole Rupiah, direction from the balance), BSI (debits printed `- 1,000.00`), blu (amount on the line
    after the description).
- Only two real statements exist to test with (`data/private/`: BCA PDF, SMBC Touchbiz PDF — both NYAMBUNG today).

Who feels it: an accountant whose client banks outside the big four, and every investor/buyer conversation ("which banks?").
Intended outcome: Buku names **25 Indonesian banks**, reads each one's documented exports, reads **MT940 from any bank**, and says
which bank a file is from — with every layout pinned by a synthetic fixture whose running balance must chain.

## Spec
- [ ] **S1 Bank registry** — one module (`lib/banks.ts`) owns the bank list: code, display name, how to recognise its files
  (heading names, product names, SWIFT BIC), and the formats Buku has a fixture for. The client form, the bank-account card, the
  onboarding validation, the import help text, the parser's bank detection and the transfer matcher's bank-name words all read it
  (today the list is copied in 5 places). 25 banks + *Bank lain*:
  BCA, Mandiri, BRI, BNI, BSI, CIMB Niaga, Permata, Danamon, OCBC, Panin, BTN, Maybank, UOB, Bank Mega, Sinarmas, SMBC Indonesia / Jenius,
  Bank Jago, SeaBank, blu (BCA Digital), DBS, HSBC, Citibank, Bank DKI, BJB, Bank Jatim.
- [ ] **S2 Schema** — `BankCode` gains the 21 new values (**migration**: `ALTER TYPE … ADD VALUE`, additive only; existing rows keep
  their code). `SMBC` stays the code for SMBC Indonesia / Jenius / BTPN.
- [ ] **S3 Detection** — a file is tagged with its bank from the lines above its table (PDF preamble, CSV/XLSX title rows) or the MT940
  header/BIC, never from transaction text. Strict names only ("Bank Permata", "PermataNet", BIC `BBBAIDJA` — not "PT Permata Hijau";
  "Bank Mega", not "CV Mega Jaya"; Jago only as "Bank Jago"/BIC). A file naming no bank stays GENERIC. Guard tests for company names.
- [ ] **S4 MT940** — a SWIFT MT940 file (`.txt`, `.sta`, `.940`, `.mt940`, any name; sniffed by `:20:` + `:25:` + `:60F:`/`:61:`) is read:
  `:60F/:60M` opening, `:61:` rows (value date `YYMMDD`, optional entry date, `C`/`D`/`RC`/`RD`, comma decimals, funds code), `:86:`
  narrative (multi-line) as the description, `:62F/:62M` closing, several statements per file, intermediate pages (`:60M`/`:62M`)
  joined per account, several accounts → sections like a combined PDF, the account from `:25:` (with or without a `BIC/` prefix),
  the currency from `:60F:` (non-IDR sections are listed, not imported — as today). Bank from the BIC in block 1/2 or `:25:`.
  Accept `.txt/.sta/.940/.mt940` in the upload field.
- [ ] **S5 Reader fixes for the documented layouts** (each with a synthetic fixture of the same five August rows, `expectAugust`):
  - tabular: an amount cell carrying its direction (`1,000.00 CR`, `5,500.00 D`, `1.000-`, `Db.`/`Cr.` flags); KlikBCA Bisnis current CSV
    (BCA reader reads both layouts); KlikBCA Individual CSV (unquoted commas in the description, `=` metadata, `Starting/Ending
    Balance` trailer); more header synonyms (`Tanggal & Waktu`, `Date & Time`, `Rincian Transaksi`, `Transaction Details`, `Remark`,
    `Withdrawal(s)`/`Deposit(s)`, `Debit Amount`/`Credit Amount`, `Running Balance`, `Ledger Balance`, bilingual `Tanggal/Date`); opening /
    closing labels `Starting Balance`, `Previous Balance`, `Initial Balance`, `Saldo Sebelumnya`, `Current Balance`.
  - PDF: bilingual header cells (`Nominal/Amount`), a leading row-number column, `Db.`/`Cr.`/`D`/`K` markers, `+`/`-` signed amounts with
    either number style, a time on the line after the date, an amount on the line after the description (blu), pocket/sub-account
    sections (Jago) as statements of their own.
  - Layouts covered: BCA (KlikBCA Bisnis CSV old + current, KlikBCA Individual CSV, e-statement PDF, mutasi print PDF), Mandiri (Livin'
    PDF, savings PDF, MCM/Kopra PDF + CSV/XLSX), BRI (Rincian PDF, IBBIZ PDF, QLola XLSX, CSV), BNI (old PDF, corporate PDF, wondr PDF,
    BNIDirect CSV/XLSX), BSI PDF, CIMB (OCTO CSV/XLSX/PDF), Permata (CSV/XLSX), Danamon CSV, OCBC CSV, BTN PDF, Jago PDF, SeaBank PDF,
    blu PDF, SMBC/Jenius (existing) — and MT940 for every bank that issues it. Banks with no public column layout are recognised by name and pinned by
    MT940 where they issue it (Maybank, UOB, DBS, HSBC, Citi, Jatim) or by a generic-reader fixture marked *layout inferred* in the
    registry (Panin, Mega, Sinarmas, DKI, BJB) — the registry says which evidence each format rests on.
- [ ] **S6 Coverage is provable** — a registry test fails if a bank declares a format without a fixture that parses NYAMBUNG and is
  tagged with that bank; `docs/real-data.md` "Supported" points to the registry instead of a hand-kept sentence.
- [ ] **S7 UI** — the bank field in *Tambah klien* and the entity card is a searchable picker over the 25 banks (+ *Bank lain*); the
  import card says which files are read ("PDF, CSV, Excel atau MT940 dari 25 bank") with the bank list behind a disclosure; the import
  result names the bank the file is from, and says so when it differs from the account's bank (a note, not a refusal — a client may
  label an account wrongly).
- [ ] **S8 No regression** — the two real files in `data/private/` still NYAMBUNG with the same rows (checked locally, never committed),
  every existing parser test passes unchanged, `verify:books` ALL PASS, e2e green.
- [ ] **S9 Production check** — after merge, on https://native-erp-v2.vercel.app (Chrome): a throwaway client *Uji Bank (hapus)* gets
  accounts at several new banks; synthetic fixture files (BNI PDF, Jago PDF, MT940 multi-account, KlikBCA Bisnis CSV) import with
  *Saldo nyambung*; then the client is deleted (admin delete, rule 25). No real client is touched.
- [ ] **Deck (ship step 3)** — claims to update: kantor slide "PDF dari bank. BCA, Mandiri, BRI, SMBC…", perusahaan slide "PDF, CSV,
  atau Excel dari bank. BCA, Mandiri, BRI, SMBC…", and the competitor/objection slides if they compare import.

**Non-goals:** live bank feeds / APIs (SNAP, KlikBCA API); foreign-currency statement import (stays "listed, not imported");
MT942 (intraday); OFX/QIF/CAMT.053 (not offered by Indonesian banks per research); OCR changes; AI parsing of unknown layouts;
per-bank `:86:` structured-field parsing beyond using it as the description; changing `parseRupiah` or the repair rule (rule 12).

**Gate-reopeners flagged:** **schema migration** (S2, additive enum values). No new dependency, no AI credit, no accounting-invariant
change (rows still go through the same continuity check, repair, dedupe and classifier; the transfer matcher's bank-word list only
grows — re-checked with `verify:books`).

**Assumptions:**
1. Layouts come from public parser code/fixtures and bank docs (confidence H for the ones listed in S5), not from real files — real
   files may differ. That's acceptable because a misread can't post silently: the running balance must chain or the import shows the
   break. Fixtures are synthetic (fake names, `0000…` numbers) under `tests/`; nothing from `data/private/` is committed.
2. "Supports bank X" in UI/deck = Buku recognises the bank and has at least one fixture-tested format for it (its own layout or MT940).
   The deck claims "25 bank" only if S6's test passes for all 25.
3. Enum over free text for `BankCode`: keeps DB integrity; a 26th bank is one more `ADD VALUE` migration.
4. The production check (S9) creates and then deletes one clearly named test client in the real workspace with synthetic data only.
   Say no and I'll do S9 locally on a production build instead.
5. Merge when green (as standing practice); the deck commit rides on the same PR after it opens.

## Tasks
- [x] T1 Bank registry + migration — `lib/banks.ts`, `BankCode` +21 values, client form / entity card / onboarding read it (searchable
  picker) — accept: new client with a BNI and a Jago account saves; db test on onboarding; migration applies on a fresh DB.
- [x] T2 Detection from the registry — `detectFormat` → registry; tabular/PDF tag every bank; transfer matcher words from the registry
  — accept: guard tests (company names) + one tag test per bank; `verify:books` ALL PASS.
- [x] T3 Tabular direction-in-cell + KlikBCA current/Individual CSV (depends T2) — accept: `bca-bisnis-2026.csv`,
  `bca-individual.csv`, `mandiri-savings-dsuffix.csv`, trailing-minus fixture → `expectAugust`; old KlikBCA test unchanged.
- [x] T4 Tabular header/label synonyms + layouts: BRI QLola, BNIDirect, CIMB, Permata, Danamon, OCBC, MCM/Kopra CSV/XLSX — accept: one
  fixture each → `expectAugust` + right bank.
- [x] T5 PDF: bilingual headers, row-number column, `Db./Cr.` and `D/K` markers, signed amounts; Mandiri Livin', Mandiri savings,
  MCM/Kopra, BNI old/corporate/wondr, BRI Rincian/IBBIZ, BSI, BTN fixtures — accept: each → `expectAugust` + right bank.
- [ ] T6 PDF: time on next line, amount on next line (blu), pocket sections (Jago), year-less `DD MON` (SeaBank) — accept: Jago (2 pockets
  → 2 sections), SeaBank, blu fixtures → continuous.
- [ ] T7 MT940 parser + upload accept list — accept: single statement, multi-page `:60M/:62M`, multi-account → sections, USD section
  listed not imported, `RD`/`RC` reversals, `:86:` multi-line, BIC → bank; malformed tag → clear Bahasa error.
- [ ] T8 Coverage test + docs — registry × formats test; `docs/real-data.md` + README supported list point to the registry —
  accept: removing a fixture fails the test.
- [ ] T9 Import UI: supported-files text + bank list disclosure, detected bank on the result, mismatch note — accept: e2e step imports
  a BNI fixture into a BNI account and sees "BNI"; screenshot 1440 + 390.
- [ ] T10 End-of-cycle: real files still NYAMBUNG (local), full gates, Ship Notes — accept: gate tails pasted.

## Implementation
- Plan: tasks T1–T10 sequential, done inline (T2–T7 all touch `lib/import/parsers/*` and `tests/bank-fixture.ts`; MT940 is a new file but
  shares the detection and the fixtures, so no slice is independent enough to delegate).
- T1: `lib/banks.ts` (25 banks: code, names, group, BIC, strict heading pattern, transaction words, formats with evidence level;
  `detectBank`, `bankOfBic`, `bankOptions`, `bankName`), `prisma/schema.prisma` + `migrations/20261009100000_bank_codes` (21 `ADD VALUE`),
  `components/app/bank-picker.tsx` (the searchable `AccountPicker`, now with `searchPlaceholder` / `emptyText` / `labelOf`),
  `client-form.tsx` + `entities-card.tsx` (picker, no local bank list), `lib/onboarding.ts` (validates against `BANK_CODES`; a blank
  account name is the bank's short name). Test: `tests/db/onboarding.test.ts` (BNI, Jago, SMBC accounts; unknown code refused).- T2: `lib/import/parsers/pdf.ts` (`detectFormat` → `detectBank`, so PDF, CSV and XLSX preambles name all 25 banks),
  `lib/classify/transfer.ts` (bank words = BANK/GIRO/TABUNGAN + the registry's words: a superset of the old list, adds BLU, OCTO, NISP,
  SINARMAS, DIGIBANK, CITI(BANK), DKI, JAKONE, BJB, JATIM). Tests: `tests/unit/bank-detect.test.ts` (a heading per bank, company-name
  guards, blu vs BCA, BSI vs Mandiri, BIC); `bank-parsers.test.ts` CIMB preamble now CIMB (was GENERIC: no code then) + a Permata guard.
- T3: `parsers/common.ts` (`splitMarker`: CR/DB/DR/D/K/C with or without a dot or space, a trailing minus), `parsers/tabular.ts` (an amount
  column's marker sets the sign, with a note; a balance marked DB is below zero; `Db.`/`Cr.` flag values), `parsers/bca.ts` (KlikBCA Bisnis
  reads full dates and the direction inside the amount as well as the old `'DD/MM` + DB/CR column; new `parseBcaIndividual` for KlikBCA
  Individual: `=` metadata, descriptions with commas read from both ends, Starting/Ending Balance), `parsers/index.ts` (routing).
  Tests: `tests/bank-layouts.ts` (the layout catalog) + `tests/unit/bank-layouts.test.ts`, `bank-parsers.test.ts` (5 marker styles, note,
  overdrawn balance, Db./Cr. column), `split-marker.test.ts`.
- T4: `parsers/tabular.ts` (header words: `Txn Date`/`Tgl. Txn`, `Tanggal & Waktu`, `Rincian Transaksi`, `Transaction Details`, `Particulars`,
  `Narrative`, `Withdrawal(s)`/`Deposit(s)`, `Dana Masuk/Keluar`, `Incoming/Outgoing`, `Running/Ledger Balance`, `Transaction Amount`;
  bilingual cells read by the part a pattern knows (`headerLabel`); opening/closing rows `Starting/Previous/Initial Balance`,
  `Current Balance`). Layouts added to the catalog: Mandiri Livin'/MCM Excel + Kopra/MCM CSV, BRI CMS (TGL_TRAN) + internet banking CSV
  + QLola Excel, BNIDirect CSV/Excel + BNI Mobile Excel, CIMB OCTO CSV/Excel, PermataNet CSV/Excel; inferred: Danamon CSV, OCBC CSV,
  Panin Excel, Mega Excel, Bank DKI CSV, bjb Excel.
- T5: `parsers/pdf.ts` (header words as in T4 plus `Trans Description`, `Tanggal & Jam`; bilingual header cells by their known part;
  a `skip` column kind — `No`, `Cabang`/`Branch`, `Journal`, `Teller` — whose cells left of the description are dropped (only left of it,
  so no amount can be pulled off its column); `Db.`/`Cr.`/`C` markers; Debit/Credit columns read unsigned (BSI prints `- 1,000.00`);
  bilingual balance labels `Saldo Awal/Initial Balance`, `Saldo Awal / Previous Balance`, `Last Bal`, `Current Balance`; a `WIB/WITA/WIT`
  after the time is no description). Layouts: BCA e-statement + KlikBCA mutasi print, Mandiri Livin' e-statement + savings + MCM/Kopra,
  BNI corporate + savings + wondr, BRI Rincian + IBBIZ, BSI, BTN, CIMB, Sinarmas (inferred). The layout test also checks every
  description starts with the bank's text (the BNI file failed that before the skip columns). Real files (BCA, SMBC) and the 26 private
  audit fixtures: same row hashes before and after (local check, `data/private/scratch/`, not committed).

## Verification
- T1: `npm run lint` 0 errors (1 existing warning in `public/deck/deck.js`) · typecheck clean · `npm test` 185 files, 1218 passed.- T2: `npm test` 186 files, 1224 passed · `npm run demo:reset && npm run verify:books` → ALL PASS — 1765 pemeriksaan saldo cocok
  (before the reseed the local DB was stale from earlier sessions and showed 4 CV Sinar Retail differences; the reseed runs the new code).
- T3: `npm test` 188 files, 1235 passed; lint 0 errors; typecheck clean.
- T4: `npm test` 188 files, 1253 passed (`bank-layouts.test.ts` 20 layouts); lint 0 errors; typecheck clean.
- T5: `npm test` 188 files, 1267 passed (34 layouts); lint 0 errors; typecheck clean; real-file and private-fixture row hashes unchanged.

## Ship Notes

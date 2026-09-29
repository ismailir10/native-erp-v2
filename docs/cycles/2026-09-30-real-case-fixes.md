# Real-case fixes — Belifi & Goers production E2E

## Context
A production E2E on 2026-09-30 with real files (Belifi: BCA PT June + SMBC owner May, 4 accounts; Goers: Jurnal.id neraca and
L/R, May 2026) walked setup → import → saldo awal → review → reports → close in rules-only mode (production has no AI key). Report
kept privately: `data/private/reports/prod-e2e-2026-09-30.md`. The books reconciled to the rupiah, but an accountant hit these:

- **Rules-only classification is weak on common bank lines.** SMBC "Bunga - Interest" out of a PRK, "BIAYA - Fee Payment",
  "Bea Materai - Stamp Duty" and BCA "BI-FAST DB BIF BIAYA TXN" all fell to 6190 Beban Umum. Firm rules are copied into each firm at
  creation (`lib/setup.ts`), so new rules need a data migration for existing firms.
- **SMBC parser glues a description line onto the wrong row.** SMBC prints a two-line description centred on the amount line: the first
  line sits ~3 pt *above* the amounts, so `parseLines` appends it to the previous row. "Pajak Bunga - Tax on Interest" landed on the
  interest row, and the tax row (Rp 2.958.904) missed the PAJAK BUNGA → 8200 rule.
- **The owner's opening balance is wrong by Rp 3,6 M.** The same SMBC PDF prints "Detail Produk Deposito" (0524DEP004097,
  Rp 3.600.000.000, 5%, jatuh tempo 26-08-2026), which backs the PRK BTB (−3,59 M). Buku ignores it, so Alfi's Saldo Awal plugs
  −3,58 M into 3200. Loan rows (Jenius "Pinjaman - Loan") show a loan existed before the books started, with no prompt to enter it.
- **Owner (Perorangan) books get company guesses:** inflow → 4100 Penjualan (Rp 398 jt into the owner's Jenius), outflow → 6190.
- **Close controls miss real red flags:** Goers equity −12,93 M (liabilities > assets) passes every control and CALK has no
  going-concern note; PT Belifi (trading) books Penjualan 518 jt with zero HPP (99% margin) and passes. CALK shows a deferred tax
  asset of 620.993.858 that isn't on the Neraca (the note prints a computed estimate, not the posted balance).
- **Tanya Buku** "Transaksi apa saja yang belum jelas dan perlu ditanyakan ke klien?" answers "Tidak ada mutasi bank dengan 'klien'".
- **Jurnal.id L/R upload** fails with a generic "Tabel buku besar atau neraca tidak ditemukan" and could be misread as a Neraca.
- **Review/picker friction:** the "pilihan ini dipakai lagi" toast shows even when nothing was learned (generic keys); the "Minta saran AI"
  banner shows when AI isn't configured; the active card is tracked by index and never scrolled into view; Enter on a focused button
  accepts the active card instead; the account search's Enter picks nothing (no auto-highlight) and keys typed while the list opens are lost.
- **Input lost right after a page load** (typed text wiped, first click ignored): input before hydration. Beranda also runs a mount-time
  `router.replace` (`components/app/workspace-scope.tsx`) that re-renders and clears the Tanya Buku textarea.
- Import polish: "Impor juga ke …" is offered for an account already imported from the same file; a new bank row defaults to BCA.

Who feels it: the accountant closing a real client's month, especially without AI.

## Spec
**Classification & parsing**
- [ ] **C1 Rules:** new firm rules — `BUNGA`/`INTEREST` OUT → 7110, `INTEREST` IN → 4900, `TAX ON INTEREST` OUT → 8200 (PPh 4(2)),
      `BIAYA TXN`, `FEE PAYMENT`, `MATERAI`, `STAMP DUTY` OUT → 7100. `PAJAK BUNGA` still wins over `BUNGA` (priority 10 vs 20).
      Seeded for new firms (`FIRM_RULES`) and inserted for existing firms by a data migration (only where the firm has no seed rule with
      that pattern + direction). Replaying the Belifi SMBC/BCA rows: interest → 7110, fee/materai/BI-FAST fee → 7100, deposit tax → 8200.
- [ ] **C2 SMBC lead-in line:** a date-less description line on the same page that sits within 5 pt above the next dated line, and is
      closer to it than to the current row, belongs to the next row. Synthetic fixture reproduces the SMBC layout; the tax row reads
      "Pajak Bunga - Tax on Interest DEP0524DEP004097", the interest row "Bunga - Interest DEP0524DEP004097". Existing parser tests unchanged.
- [ ] **C3 Owner fallbacks:** for a PERORANGAN entity the simple guess is inflow → 4910 Pendapatan Lain-lain ("uang masuk pribadi —
      pastikan sumbernya: dari PT, pinjaman, atau penghasilan"), outflow → 3300 Prive. Companies unchanged (4100 / 6190). The same
      fallback applies to *Terima serupa*.

**Saldo Awal**
- [ ] **O1 Deposits from the statement:** the PDF parser reads SMBC "Detail Produk Deposito" rows (number, currency, rate, maturity,
      balance); the import stores them (`StatementImport.deposits`, JSON). Saldo Awal offers each IDR deposit of the entity not yet in its
      opening as a line — account 1260 (changeable), amount prefilled, source "Deposito 0524DEP004097 di smbc-mei-2026.pdf, jatuh tempo
      26-08-2026, bunga 5%". Accepting it makes the Alfi plug ≈ +20 jt instead of −3,58 M.
- [ ] **O2 Loan hint:** when an entity without a posted opening has imported rows suggested as loan principal (2210 by the financing
      heuristic), Saldo Awal says "Mutasi berisi angsuran/pencairan pinjaman — kalau ada sisa pinjaman per <tanggal>, tambahkan 2210".

**Controls & reports**
- [ ] **R1 Going concern:** REVIEW control "Defisiensi modal" per company entity when total equity < 0 at period end (detail: equity,
      liabilities vs assets). CALK adds a "Kelangsungan usaha" paragraph (equity deficit and accumulated losses, management's plans left
      for the accountant to fill) when equity < 0.
- [ ] **R2 Trading without cost of sales:** REVIEW control when the client's *Bidang usaha* reads as trading (dagang, perdagangan,
      toko, retail, distributor, grosir, jual beli, trading) and an entity has revenue in the month with zero HPP/purchases — hint:
      purchases may have been paid by the owner or from another account.
- [ ] **R3 Deferred tax note = Neraca:** CALK prints the posted 1270/2320 balance as the deferred tax line; a computed amount that
      differs is shown as "Estimasi belum dicatat: … — catat di Pajak Badan", never as the balance.
- [ ] **R4 Tanya Buku "what to ask the client":** questions like "transaksi yang belum jelas / perlu ditanyakan ke klien / pertanyaan
      untuk klien" list rows still in review (1999) per entity — date, account, description, amount, current suggestion — with a link to
      Review. Deterministic; routed before the payee search.
- [ ] **R5 Profit & loss upload:** a sheet whose title/headers read as a Laba Rugi / Profit & Loss report is never read as a Neraca;
      the upload says "File ini laporan laba rugi. Impor neraca atau buku besar; laba rugi tahun berjalan ada di saldo laba neraca."

**Review & import UX**
- [ ] **U1 Honest toast:** the review save reports whether Memory learned the choice; the toast says "dipakai lagi di impor berikutnya"
      only then.
- [ ] **U2 AI banner:** when AI isn't configured, the banner says so and (admins) links to Pengaturan instead of offering the button.
- [ ] **U3 Review keyboard:** the active card is tracked by id (survives refreshes and accepts), scrolled into view when it changes;
      Enter on a focused button/checkbox does that control's action, not "accept".
- [ ] **U4 Account picker:** the first match is highlighted so Enter picks it; typing on the closed trigger opens the list with those
      characters in the search (no keys lost).
- [ ] **U5 Import:** "Impor juga ke …" hides accounts that already have an import of the same file period; "Tambah rekening" copies the
      previous row's bank.
- [ ] **U6 Input before hydration:** Beranda no longer calls `router.replace` on mount (canonical scope/period resolved on the server
      or taken from links); the client form and the Tanya Buku box keep text typed before hydration. An e2e types right after `goto` on
      /clients/new and Beranda and asserts the value stays.

**Non-goals:** per-entity close (Period is per client — schema/workflow change); importing a L/R as year-to-date journals; restricted-cash
wording for customer funds; PRK opening input layout; AI key setup (user action in Pengaturan); fixing hydration time itself beyond U6.

**Gate-reopeners (flagged):** two migrations — `StatementImport.deposits Json @default("[]")` (additive schema) and a **data insert** of
new firm rules for existing firms. No new dependency, no AI credit, no invariant change (rules auto-post as today; C3 guesses stay in review).

**Assumptions:**
1. A pledged/auto-roll deposit goes to 1260 (non-current, restricted), not cash; the accountant can pick another account.
2. Owner fallbacks: inflow → 4910 Pendapatan Lain-lain, outflow → 3300 Prive (still low-confidence guesses in review).
3. Interest charged *out* of any bank account is loan/overdraft interest (7110); stamp duty goes to 7100 with other bank charges.
4. "Trading" is read from the client's free-text *Bidang usaha*; no new field.
5. Negative-equity and zero-HPP checks are REVIEW (need a note), not FAIL.

## Tasks
- [x] T1 SMBC lead-in line + deposit table in the PDF parser (C2, O1 parse) — accept: unit tests with synthetic SMBC lines; existing parser tests pass.
- [x] T2 Firm rules + data migration (C1) — accept: unit test replays the Belifi descriptions through `matchRule`; migration applied locally, `prisma migrate diff` empty.
- [x] T3 Owner fallbacks (C3) — accept: DB test imports a statement into a PERORANGAN entity → 4910/3300 guesses; PT unchanged.
- [x] T4 Deposits on the import + Saldo Awal suggestion + loan hint (O1, O2) — accept: DB test (import stores deposits; opening context offers them once; posted opening hides them); page shows both. Depends T1.
- [ ] T5 Controls: going concern + trading without HPP (R1 control, R2) — accept: DB tests for both (PASS/REVIEW cases).
- [ ] T6 CALK: going-concern paragraph + deferred tax = posted (R1 note, R3) — accept: DB test on notes.
- [ ] T7 Tanya Buku client-query intent + L/R upload message (R4, R5) — accept: unit/DB tests on intent and on a synthetic Jurnal.id L/R sheet.
- [ ] T8 Review & picker UX (U1–U4) — accept: e2e/unit where feasible; manual check in the browser.
- [ ] T9 Import polish (U5) — accept: unit test on the "impor juga" filter; client form check.
- [ ] T10 Input before hydration (U6) — accept: e2e types immediately after navigation on /clients/new and Beranda; value persists.
- [ ] T11 Docs + end-of-cycle gates — accept: lint, typecheck, tests, build, `verify:books` ALL PASS, full e2e; README/real-data notes.

## Implementation
- Plan: T1–T11 sequential, inline (the tasks share pipeline, review and opening code; one driver keeps the accounting rules consistent).
- T1: `lib/import/parsers/pdf.ts` (a date-less text line ≤ 5 pt above the next dated line, nearer to it than to the current row, starts that row's description and its `rawRow`; `depositProducts()` reads "Detail Produk Deposito" rows onto every section), `lib/import/types.ts` (`DepositProduct`), `tests/pdf-fixture.ts` (`smbcGiroDepositPdf`, real positions), `tests/unit/pdf.test.ts`. Real files: SMBC tax row now "Pajak Bunga - Tax on Interest DEP0524DEP004097", deposit 0524DEP004097 Rp 3.600.000.000 read; BCA output identical to before.
- T2: `lib/classify/rules.ts` (TAX ON INTEREST → 8200 PPh 4(2); INTEREST in → 4900; BUNGA/INTEREST out → 7110; BIAYA TXN, FEE PAYMENT, MATERAI, STAMP DUTY → 7100), migration `20260930010000_bank_charge_rules` (inserts each missing seed rule per firm, idempotent), `tests/unit/import.test.ts` (Belifi descriptions replayed). Changed behaviour: loan interest charged by the bank is now RULE-posted to 7110 instead of a HEURISTIC to review — `tests/db/financing-classify.test.ts` and `tests/db/sanity-controls.test.ts` updated (the latter's accepted-guess case now uses a principal instalment).
- T3: `lib/classify/fallback.ts` (`simpleGuess(direction, kind)`: PERORANGAN in → 4910 with "pastikan sumbernya", out → 3300 Prive; companies 4100 / 6190), used by `lib/import/pipeline.ts` and `acceptSimilar` in `lib/review.ts`; `tests/db/owner-fallback.test.ts`.
- T4: `prisma/schema.prisma` + migration `20260930020000_statement_deposits` (`StatementImport.deposits` JSONB, default []), `lib/import/pipeline.ts` (stores the parsed deposits, idrBalance as a string), `lib/opening.ts` (`deposits` per entity — once per number, IDR only, with file, maturity and rate — and `loanRows` = rows suggested/posted to 2210), `lib/coa/template.ts` (`BANK_LOAN` 2210, `DEPOSIT` 1260), `components/app/opening-form.tsx` (deposit lines prefilled on 1260, removable; a note for each and for loan rows), opening page; `tests/db/opening-deposits.test.ts`.

## Verification
- T1 gate: lint ✓ typecheck ✓ `Test Files 92 passed (92) · Tests 624 passed (624)`.
- T2 gate: lint ✓ typecheck ✓ `Test Files 92 passed (92) · Tests 625 passed (625)`; `prisma migrate diff` → No difference detected.
- T3 gate: lint ✓ typecheck ✓ `Test Files 93 passed (93) · Tests 626 passed (626)`.
- T4 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 627 passed (627)`; `prisma migrate diff` → No difference detected.

## Ship Notes

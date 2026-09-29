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

- **U6 as built (evidence changed the fix):** with the app's JavaScript delayed 1.5 s, text typed into the server HTML survives
      hydration even without any change (React 19 keeps it) — the e2e stays as a guard. Production timing showed the real cause:
      documents stream for 0,3–3,7 s (cold starts; the function already runs in sin1 next to Supabase), and until then the previous
      page stays on screen, so input lands there. Fix: a navigation progress bar shows at once on every in-app link, Beranda writes its
      canonical scope into the URL with `history.replaceState` instead of a second server render, and the two upload forms pick up a
      file chosen before hydration (React replays typed text, not a file input's change). A root `loading.tsx` was tried first and
      dropped: it streams every page, which made existing flows race (files set before hydration, momentary duplicate content).

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
- [x] T5 Controls: going concern + trading without HPP (R1 control, R2) — accept: DB tests for both (PASS/REVIEW cases).
- [x] T6 CALK: going-concern paragraph + deferred tax = posted (R1 note, R3) — accept: DB test on notes.
- [x] T7 Tanya Buku client-query intent + L/R upload message (R4, R5) — accept: unit/DB tests on intent and on a synthetic Jurnal.id L/R sheet.
- [x] T8 Review & picker UX (U1–U4) — accept: e2e/unit where feasible; manual check in the browser.
- [x] T9 Import polish (U5) — accept: unit test on the "impor juga" filter; client form check.
- [x] T10 Input before hydration (U6) — accept: e2e types immediately after navigation on /clients/new and Beranda; value persists.
- [x] T11 Docs + end-of-cycle gates — accept: lint, typecheck, tests, build, `verify:books` ALL PASS, full e2e; README/real-data notes.

## Implementation
- Plan: T1–T11 sequential, inline (the tasks share pipeline, review and opening code; one driver keeps the accounting rules consistent).
- T1: `lib/import/parsers/pdf.ts` (a date-less text line ≤ 5 pt above the next dated line, nearer to it than to the current row, starts that row's description and its `rawRow`; `depositProducts()` reads "Detail Produk Deposito" rows onto every section), `lib/import/types.ts` (`DepositProduct`), `tests/pdf-fixture.ts` (`smbcGiroDepositPdf`, real positions), `tests/unit/pdf.test.ts`. Real files: SMBC tax row now "Pajak Bunga - Tax on Interest DEP0524DEP004097", deposit 0524DEP004097 Rp 3.600.000.000 read; BCA output identical to before.
- T2: `lib/classify/rules.ts` (TAX ON INTEREST → 8200 PPh 4(2); INTEREST in → 4900; BUNGA/INTEREST out → 7110; BIAYA TXN, FEE PAYMENT, MATERAI, STAMP DUTY → 7100), migration `20260930010000_bank_charge_rules` (inserts each missing seed rule per firm, idempotent), `tests/unit/import.test.ts` (Belifi descriptions replayed). Changed behaviour: loan interest charged by the bank is now RULE-posted to 7110 instead of a HEURISTIC to review — `tests/db/financing-classify.test.ts` and `tests/db/sanity-controls.test.ts` updated (the latter's accepted-guess case now uses a principal instalment).
- T3: `lib/classify/fallback.ts` (`simpleGuess(direction, kind)`: PERORANGAN in → 4910 with "pastikan sumbernya", out → 3300 Prive; companies 4100 / 6190), used by `lib/import/pipeline.ts` and `acceptSimilar` in `lib/review.ts`; `tests/db/owner-fallback.test.ts`.
- T4: `prisma/schema.prisma` + migration `20260930020000_statement_deposits` (`StatementImport.deposits` JSONB, default []), `lib/import/pipeline.ts` (stores the parsed deposits, idrBalance as a string), `lib/opening.ts` (`deposits` per entity — once per number, IDR only, with file, maturity and rate — and `loanRows` = rows suggested/posted to 2210), `lib/coa/template.ts` (`BANK_LOAN` 2210, `DEPOSIT` 1260), `components/app/opening-form.tsx` (deposit lines prefilled on 1260, removable; a note for each and for loan rows), opening page; `tests/db/opening-deposits.test.ts`.
- T5: `lib/controls/sanity.ts` (#6 `going-concern:` REVIEW for a non-PERORANGAN entity whose ASET + LIABILITAS nets are < 0 while assets ≥ 0; #7 `no-cogs:` REVIEW when the client's *Bidang usaha* matches `TRADING` and the month (OPENING excluded) has PENDAPATAN_USAHA > 0 with HPP net 0), `lib/controls/index.ts` (passes `industry`); `tests/db/sanity-controls.test.ts` (+2).
- T6: `lib/reports/notes.ts` (note *Kelangsungan usaha* after *Umum* when the Neraca's equity < 0: liabilities, assets, equity, accumulated loss = SALDO_LABA + LABA_BERJALAN, a placeholder for management's plans; the tax note's deferred line = posted 1270 + 2320 through the period end, and a differing pack figure as *Estimasi pajak tangguhan belum dicatat (catat di Pajak Badan)* = computed − posted), `lib/tax/pack.ts` (`glBalance` exported); `tests/db/statements.test.ts` (+1, and posted vs estimate).
- T7: `lib/workspace/index.ts` (intent `unclear` before readiness/payee: NEEDS_REVIEW bank lines of the scope up to the month's end, oldest first, totals per currency, 30 rows with the current guess, citations to Review), `components/app/workspace-ask.tsx` (example *Apa yang perlu ditanyakan ke klien?*), `lib/ledger-import/read.ts` (`reportKind()`: title rows naming Laba Rugi / Profit & Loss / Arus Kas / Cash Flow → never a table candidate), `lib/ledger-import/post.ts` (the upload names the report instead of the generic message); `tests/db/workspace.test.ts` (+1), `tests/unit/ledger-read.test.ts` (+1). Real Goers files: L/R and arus kas → no candidate, neraca still NERACA.
- T8: `app/actions.ts` (`reviewAction` returns `learned` = the key names a counterparty), `components/app/review-queue.tsx` (toast says "dipakai lagi" only when learned; active card tracked by id, moved to the next card on accept and to the next remaining one after *serupa*, scrolled into view; Enter on a focused button/checkbox/link does that control; banner without AI says so and links admins to Pengaturan), review page (`aiReady` from `resolveAiConfig`, `canSetUpAi` = ADMIN), `components/app/account-picker.tsx` (`autoHighlight`; controlled open + query; printable keys on the closed trigger open it with the key in the search), `e2e/review-safety.spec.ts` (correction typed on the closed picker + Enter).
- T9: `lib/import/pipeline.ts` (`otherAccounts[].imported`: an account of the client already holds an import of that section's period), `components/app/import-form.tsx` (no *Impor juga ke* for those), `components/app/client-form.tsx` (*Tambah rekening* copies the previous row's bank); `tests/db/smbc-import.test.ts`.
- T10: `app/(app)/loading.tsx` (skeleton with `role=status` on every in-app navigation), `components/app/workspace-scope.tsx` (canonical `scope`/`period` via `history.replaceState`, no `router.replace` → no second server render on Beranda), `e2e/early-input.spec.ts` (JS chunks delayed 1.5 s; typing into the server HTML on /clients/new and Beranda survives; Beranda URL names its scope). Tried and dropped: adopting pre-hydration DOM values in `Input`/textarea — the e2e passes without it (negative check), so it would be dead code.
- T10 (end of cycle, replacing the \`loading.tsx\` above): \`components/app/navigation-progress.tsx\` (capture-phase click on a same-origin link → a 2 px bar with \`role=status\` until the URL changes, 15 s safety reset) mounted in \`app/(app)/layout.tsx\`; \`components/app/keep-early-file.ts\` used by \`import-form.tsx\` and \`ledger-import-form.tsx\`; \`e2e/early-input.spec.ts\` also checks the bar on a delayed navigation. The first full e2e run with \`loading.tsx\` failed 6 specs (4 × "Proses mutasi" disabled — file set before hydration; 2 × evidence races); without it and with the file pick-up all pass.
- T11: \`.agents/skills/accounting-rules/SKILL.md\` (rule 5 deposits/loan hint, rule 13 bank-charge firm rules + entity-kind fallback, rule 22a going-concern and no-cogs), \`README.md\` (Tanya Buku client list, close checks), \`docs/real-data.md\` (Saldo Awal deposits/loans, L/R upload refused); \`e2e/opening-deposit.spec.ts\` (Tambah klien → SMBC giro import → Saldo Awal shows the deposit note and the 3.600.000.000 line; no page overflow at 390 px), screenshots at 1440 and 390 px checked by eye.
- Review of #65: Saldo Awal proposes only deposits listed on the entity's earliest statement period (a deposit placed later is a movement, not an opening balance); *Total aset negatif* and *Defisiensi modal* read the Neraca's totals (an intercompany 1190 credit is a liability there, not negative assets); CALK notes a posted 1270/2320 balance as *Pajak tangguhan* where no PPh badan reconciliation applies (final regime, a person). Tests: `tests/db/opening-deposits.test.ts`, `tests/db/sanity-controls.test.ts`, `tests/db/statements.test.ts` (+1 each).

## Verification
- T1 gate: lint ✓ typecheck ✓ `Test Files 92 passed (92) · Tests 624 passed (624)`.
- T2 gate: lint ✓ typecheck ✓ `Test Files 92 passed (92) · Tests 625 passed (625)`; `prisma migrate diff` → No difference detected.
- T3 gate: lint ✓ typecheck ✓ `Test Files 93 passed (93) · Tests 626 passed (626)`.
- T4 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 627 passed (627)`; `prisma migrate diff` → No difference detected.
- T5 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 629 passed (629)`.
- T6 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 630 passed (630)`.
- T7 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 632 passed (632)`.
- T8 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 632 passed (632)`; browser check in the end-of-cycle e2e.
- T9 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 632 passed (632)`.
- T10 gate: lint ✓ typecheck ✓ `Test Files 94 passed (94) · Tests 632 passed (632)`; `npx playwright test e2e/early-input.spec.ts e2e/workspace.spec.ts` → 4 passed. Production timing (Chrome, /clients/new): responseEnd 3.765 / 1.439 / 325 ms on three loads; `x-vercel-id: hnd1::sin1`.
- End of cycle: lint ✓ · typecheck ✓ · \`Test Files 94 passed (94) · Tests 632 passed (632)\` · \`npm run build\` ✓ · \`npx playwright test\` → \`23 passed (1.0m)\` (+ \`e2e/opening-deposit.spec.ts\` → 1 passed) · \`demo:reset\` + \`verify:books\` → \`ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.\`
- Review fixes: lint ✓ · typecheck ✓ · `Test Files 94 passed (94) · Tests 635 passed (635)` · build ✓ · `npx playwright test` → `24 passed (1.1m)` · `verify:books` → `ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.`

## Ship Notes
- **Migrations:** \`20260930010000_bank_charge_rules\` — **data insert**: 8 firm seed rules (bank interest/fees/stamp duty) for every firm
  that lacks them; idempotent. Lines already classified stay as they are. \`20260930020000_statement_deposits\` — additive column
  \`StatementImport.deposits JSONB NOT NULL DEFAULT '[]'\`.
- **Behaviour changes:** loan/overdraft interest charged by a bank now auto-posts to 7110 by rule (was a heuristic to review); a
  PERORANGAN entity's simple guess is 4910 / 3300 (was 4100 / 6190); two new REVIEW controls (*Defisiensi modal*, *Penjualan tanpa
  harga pokok*) can appear on existing clients (Goers, PT Belifi) and need a note before closing; CALK gets *Kelangsungan usaha* when
  equity < 0 and prints the posted deferred tax.
- **Env / dependency / AI:** none. **Demo:** unchanged (\`verify:books\` ALL PASS).
- **Manual steps:** none. Existing Belifi imports predate the deposits column: re-importing the same SMBC file adds no history row
  (dedupe), so the deposit is entered once by hand in Saldo Awal — or via a fresh client.
- **Rollback:** revert the merge; the deposits column can stay (unused). To remove the rules:
  \`DELETE FROM "Rule" WHERE "clientId" IS NULL AND "source" = 'SEED' AND "id" LIKE 'seed_%';\`

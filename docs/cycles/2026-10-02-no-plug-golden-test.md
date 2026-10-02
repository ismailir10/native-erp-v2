# No plug + golden test (use-case feedback, cycles 0–1)

## Context
The owner's deep use-case document ("Use Case Mendalam Uji Aplikasi Buku", 2 Oct 2026, 30 cases from the Belifi, Chickin and Arianda
folders) turns their working standard into pass criteria: GL = source of truth, **no plug**, every difference has a finding ID and a
resolution, opening + movement = closing, answers traceable to the source row. Two of the priority-1 cases are marked **Gagal** because
of one line: `lib/opening.ts` posts any Saldo Awal difference to 3200 Saldo Laba ("penyeimbang otomatis"), so a Kas difference of
Rp 60 jt between the old Neraca and the bank statements disappears into equity (UC-B4, UC-C2). The Neraca also reads "Seimbang" when total
assets are negative (UC-K1, finding #5), a report that hides its own gaps.

This cycle does the two things the review put first:
- **Cycle 0, golden test (UC-K1, UC-K5).** A synthetic dataset built on the Belifi pattern: PT and owner, three bank accounts, three months,
  more than 250 lines of eight kinds, internal and cross-entity transfers. Its answer key is computed independently of the app and committed
  as literal numbers. Every later cycle (transfer safety, import hardening, fiscal year) moves numbers and is checked against this key.
- **Cycle 1, no plug (UC-B4, UC-C2, UC-K1 #5, UC-X5).** A Saldo Awal difference becomes an open **Temuan** (finding) on a visible equity
  account, and the close is blocked until the accountant writes a decision. Each bank account also gets a month-by-month completeness view,
  the Neraca header reports what it actually knows, and Ask Buku marks answers for months not yet closed.

Spec approval: the owner reviewed the plan in chat (golden test first, then no plug, advisor-revised) and said "proceed, make your best
judgement", so this cycle runs without a separate approval stop.

## Spec
- [x] **Golden dataset.** `lib/demo/golden.ts` builds a deterministic Belifi-pattern scenario: PT + owner, BCA + Mandiri for the PT and BCA for
      the owner, Apr–Jun 2026, ≥ 250 lines covering sales to named resellers, purchases, payroll, rent, utilities, bank fees and interest,
      own-account transfers (1199), PT ↔ owner (1190) and owner prive. Statements go through the real `importStatement()`, and review uses
      the generator's truth, as the demo seed does.
- [x] **Independent answer key.** `goldenKey()` computes 20 key numbers using plain sums by account-code class, with no `lib/reports` or
      `lib/ledger`: per entity total assets, liabilities, equity, revenue, net profit, cash per bank, 1199 and 1190, plus the combined
      total assets. The numbers are committed as literals in `tests/golden/belifi-pattern.json`. The test checks calculator = file and
      app = file, to the rupiah.
- [x] **App chain to the key.** TB per entity, Laba Rugi, Neraca, and the cash flow's closing cash (= Neraca cash) match the key. Importing
      every file again adds 0 rows and leaves every number unchanged (deterministic).
- [x] **Propagation (UC-K4 part).** Reclassifying one line moves the TB, Laba Rugi and Neraca by exactly its amount, recorded as a RECLASS
      entry. Reclassifying it back restores the key.
- [ ] **No plug on Saldo Awal.** A difference between the lines typed in Saldo Awal posts to **3290 Selisih Saldo Awal** (new template
      equity account and FS line *Selisih saldo awal belum diselesaikan*, shown on its own line in the Neraca), never to 3200. In the same
      transaction it opens a **Temuan** `T-<n>` (per client) with the entity, amount, date and question
      ("Selisih saldo awal Rp X: dari mana? …").
- [ ] **Saldo Laba is typed, not plugged.** The opening form has a 3200 Saldo Laba row like any other. *Pakai selisih sebagai Saldo Laba*
      copies the current difference into it as an explicit choice, for clients without a source Neraca. While a difference remains, the
      form says it becomes a Temuan and blocks the close.
- [ ] **Resolving a Temuan.** The accountant picks the account the difference belongs to and writes a decision (≥ 10 characters). Buku then
      posts one `OPENING` entry dated the Saldo Awal date that moves the entity's whole 3290 balance to that account through
      `postJournal()`, and marks the Temuan *Selesai* with who, when, the decision and the entry. A Temuan is resolved once and never
      deleted.
- [ ] **Close gate.** Control `opening-diff:<entity>` FAILs while the entity's 3290 balance at month end is ≠ 0, naming the open Temuan
      numbers. GL-driven: a resolution reversed later brings the FAIL back. Control `opening:<entity>` is REVIEW when an entity has posted
      entries but no Saldo Awal ("neraca dimulai dari nol"); a note clears it, for example "PT baru".
- [ ] **Temuan list.** The Tutup Buku page shows each Temuan with number, entity, amount, question, status and resolution history, and the
      resolve form for open ones.
- [ ] **Completeness matrix (UC-B4).** On Tutup Buku, a bank account × month grid from the month the books start to the selected month.
      Each cell reads *ada*, *bolong* (no statement), or *tidak nyambung* (opening ≠ the previous statement's closing, or continuity broken
      inside the file), with the difference.
- [ ] **Honest Neraca header (#5).** The Neraca pill says *Seimbang* only when A = L + E, total assets ≥ 0 and nothing sits on 3290.
      Negative total assets show FAIL *Aset negatif*; an open Temuan shows REVIEW *Seimbang · n temuan terbuka*. The report status bar
      lists open Temuan as a reason the report is a draft.
- [ ] **Ask Buku (UC-X5).** An answer for a month that isn't closed (for any client in scope) carries a *Sementara* label naming the
      month. A request to change data (ubah / hapus / ganti / catat / posting / koreksi / reklasifikasi / kunci …) is refused, naming the
      page where it is done.

**Non-goals (later cycles, per the review):** transfer matcher safety (single candidate or queue, third-party refusal, unmatch, no AI for
1190/1199) is cycle 2, and the golden dataset deliberately has no ambiguous transfer until then. Undoing an import by reversal, account
merge and a change log are cycle 3. Ledger and TB import hardening (typo headers, Adjustment column, missing month at import, opening
bridge derived from a later anchor, PDF statements) is cycle 4. Per-client FS template, PDF and Excel with formulas are cycle 5;
non-calendar fiscal year is cycle 6. Also out: moving the Neraca-import source difference (1999, rule 15a) into Temuan; migrating
existing 3200 plugs (history is not rewritten); FX, consolidation and audit-package cases (deferred with reasons in the review).

**Gate-reopeners (flagged):**
- **Schema migration:** `Finding` table, `FindingKind` and `FindingStatus` enums.
- **Change to an accounting invariant:** rule 5's "the plug goes to 3200" is replaced, by ADR 0012 and an amendment to accounting-rules.
- No new dependency. No AI credit.

**Assumptions:**
1. The code is 3290 with its own FS line in equity. It sits inside the mapping range SALDO_LABA 3201–3299, but template codes are skipped
   by mapping, so new clients never get it as a mapped account. On an older client that already used 3290 for something else, posting a
   difference is refused with the existing `templateAccounts` message.
2. The resolution entry is kind `OPENING` dated the Saldo Awal date: it corrects the opening position, so it is not a flow in the cash flow
   or the changes in equity, and it doesn't make the opening month "a month with activity" that must be closed first. Every reader of
   "the opening date" already takes the earliest OPENING entry.
3. The demo seed's openings already name 3200 explicitly (the scenario's retained earnings), so it posts no difference and the demo,
   `verify:books` and the investor walk don't change.
4. The golden dataset uses no PPN tags, so the independent calculator needs no PPN split. The PPN split stays covered by `verify:books`
   and unit tests.
5. A new client with only a bank balance now gets an open Temuan for that whole balance (the "where does this equity come from"
   question). That is the intended behaviour.

## Tasks
- [x] T1 Golden scenario, independent key, committed answer file, DB test (chain, determinism, propagation). Reuse `ClientScenario`,
      `statementFiles` (made month-parameterised), `renderStatement`, `importStatement`, `reviewTransaction`. Accept:
      `npx vitest run tests/db/golden.test.ts` green, ≥ 250 lines, 20 numbers.
- [x] T2 Schema + ADR: `Finding` model and migration; 3290 in `COA_TEMPLATE`; FS line `SELISIH_SALDO_AWAL` (Neraca, changes in equity, cash
      flow fall-through); ADR 0012; accounting-rules rule 5 amended; `deleteClient` covers `Finding`. Accept: `prisma migrate diff` empty,
      typecheck, existing tests green.
- [ ] T3 Opening difference → 3290 + Temuan; `lib/findings.ts` (open, list, resolve); opening form and page copy; actions. Accept:
      `tests/db/opening.test.ts` (updated) and `tests/db/findings.test.ts` green.
- [ ] T4 Close gate and visibility: `opening-diff:` and `opening:` controls, the Temuan card on Tutup Buku, report status reason, honest
      Neraca pill. Accept: DB tests for the controls; the golden test's opening-difference case reaches the key after resolution.
- [ ] T5 Completeness matrix (`lib/controls/completeness.ts`) and its card. Accept: DB test with a missing month and a broken handover.
- [ ] T6 Ask Buku: *Sementara* label and refusal of change requests. Accept: unit test on the intent, DB test on the label.
- [ ] T7 End-of-cycle gates: lint, typecheck, test, build, `verify:books`, `test:e2e`; cycle doc Verification.

## Implementation
- Plan: tasks T1–T7 sequential, done inline (each builds on the previous: the golden test is the yardstick for T3–T4, the Finding table for T4–T6).
- Environment: the sandbox's egress policy refuses `cdn.sheetjs.com`, where the lockfile pins `xlsx`; for local gates `xlsx@0.18.5` was installed from the
  npm registry without touching `package.json` / `package-lock.json` (CI installs the pinned tarball).
- T1: `lib/demo/golden.ts` (scenario, `goldenKey`, `goldenOpeningLines`, `seedGolden`), `lib/demo/scenario.ts` (`statementFiles` takes the months),
  `tests/golden/belifi-pattern.json` (20 literals), `tests/db/golden.test.ts` — 252 lines (PT BCA + Mandiri, owner BCA, Apr–Jun 2026): reseller sales,
  marketplace settlements, purchases, payroll, BPJS, rent, utilities, ads, PPh 21 remittance, bank fees and interest, 1199 sweeps, PT → owner 1190, owner prive.
  A guard refuses any accidental transfer pair. The app matched the key on the first run.
- T2: `prisma/schema.prisma` + migration `20261002160155_findings` (`Finding`, `FindingKind`, `FindingStatus`; CHECK: open ⇔ no decision, resolved ⇔
  decision + time), `lib/coa/template.ts` (3290, FS line `SELISIH_SALDO_AWAL`, `isClassifiable` — the AI chart in the pipeline, retry and demo
  pre-cache drops it), `lib/reports/statements.ts` (an equity column; a non-opening movement reads as a Saldo Laba correction),
  `lib/clients/delete.ts`, `docs/adrs/0012-no-plug-findings.md`. The accounting-rules amendment ships with T3, where the behaviour lands.

## Verification
- T2: fresh `prisma migrate deploy` on both DBs → "All migrations have been successfully applied."; `prisma migrate diff --from-config-datasource --to-schema` →
  "This is an empty migration."; lint + typecheck clean; `npm test` → `Test Files 122 passed (122) · Tests 916 passed (916)`; `demo:reset && verify:books` →
  `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T1: `npx vitest run tests/db/golden.test.ts` → `Tests 6 passed (6)`; gate: lint clean, typecheck clean, `npm test` → `Test Files 122 passed (122) · Tests 916 passed (916)`.

## Ship Notes

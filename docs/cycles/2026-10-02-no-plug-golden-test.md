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
- [x] **No plug on Saldo Awal.** A difference between the lines typed in Saldo Awal posts to **3290 Selisih Saldo Awal** (new template
      equity account and FS line *Selisih saldo awal belum diselesaikan*, shown on its own line in the Neraca), never to 3200. In the same
      transaction it opens a **Temuan** `T-<n>` (per client) with the entity, amount, date and question
      ("Selisih saldo awal Rp X: dari mana? …").
- [x] **Saldo Laba is typed, not plugged.** The opening form has a 3200 Saldo Laba row like any other. *Pakai selisih sebagai Saldo Laba*
      copies the current difference into it as an explicit choice, for clients without a source Neraca. While a difference remains, the
      form says it becomes a Temuan and blocks the close.
- [x] **Resolving a Temuan.** The accountant picks the account the difference belongs to and writes a decision (≥ 10 characters). Buku then
      posts one `OPENING` entry dated the Saldo Awal date that moves the entity's whole 3290 balance to that account through
      `postJournal()`, and marks the Temuan *Selesai* with who, when, the decision and the entry. A Temuan is resolved once and never
      deleted.
- [x] **Close gate.** Control `opening-diff:<entity>` FAILs while the entity's 3290 balance at month end is ≠ 0, naming the open Temuan
      numbers. GL-driven: a resolution reversed later brings the FAIL back. Control `opening:<entity>` is REVIEW when an entity has posted
      entries but no Saldo Awal ("neraca dimulai dari nol"); a note clears it, for example "PT baru".
- [x] **Temuan list.** The Tutup Buku page shows each Temuan with number, entity, amount, question, status and resolution history, and the
      resolve form for open ones.
- [x] **Completeness matrix (UC-B4).** On Tutup Buku, a bank account × month grid from the month the books start to the selected month.
      Each cell reads *ada*, *bolong* (no statement), or *tidak nyambung* (opening ≠ the previous statement's closing, or continuity broken
      inside the file), with the difference.
- [x] **Honest Neraca header (#5).** The Neraca pill says *Seimbang* only when A = L + E, total assets ≥ 0 and nothing sits on 3290.
      Negative total assets show FAIL *Aset negatif*; an open Temuan shows REVIEW *Seimbang · n temuan terbuka*. The report status bar
      lists open Temuan as a reason the report is a draft.
- [x] **Ask Buku (UC-X5).** An answer for a month that isn't closed (for any client in scope) carries a *Sementara* label naming the
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
- [x] T3 Opening difference → 3290 + Temuan; `lib/findings.ts` (open, list, resolve); opening form and page copy; actions. Accept:
      `tests/db/opening.test.ts` (updated) and `tests/db/findings.test.ts` green.
- [x] T4 Close gate and visibility: `opening-diff:` and `opening:` controls, the Temuan card on Tutup Buku, report status reason, honest
      Neraca pill. Accept: DB tests for the controls; the golden test's opening-difference case reaches the key after resolution.
- [x] T5 Completeness matrix (`lib/controls/completeness.ts`) and its card. Accept: DB test with a missing month and a broken handover.
- [x] T6 Ask Buku: *Sementara* label and refusal of change requests. Accept: unit test on the intent, DB test on the label.
- [x] T7 End-of-cycle gates: lint, typecheck, test, build, `verify:books`, `test:e2e`; cycle doc Verification.

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
- T3: `lib/findings.ts` (`openFinding` numbered under a per-client lock, `openingQuestion`, `resolveOpeningFinding` under the close lock, `listFindings`),
  `lib/opening.ts` (difference → 3290 + Temuan in one transaction, returns `{ entry, finding }`; typing 3290 refused), `app/actions.ts`
  (`openingAction` returns the Temuan label, `resolveFindingAction`), `components/app/opening-form.tsx` (Saldo Laba row typed like any line,
  3290 row + notice while a difference remains, *Pakai selisih sebagai Saldo Laba*), opening page copy; accounting-rules rule 5 amended.
  Tests: `tests/db/findings.test.ts` (new), `opening.test.ts`, `opening-deposits.test.ts` (3200 → 3290).
- T4: `lib/controls/index.ts` (`opening-diff:` FAIL from the 3290 balance naming the open Temuan; `opening:` REVIEW only in the month an entity's
  books start without a Saldo Awal), `lib/reports/status.ts` (reason `findings`, listed first), `components/app/report-status.tsx` (links to
  `close#temuan`), reports page `BalancePill` (Selisih / *Seimbang, tapi total aset negatif* / *Seimbang · n temuan terbuka* / Seimbang),
  close page (NextStep for open Temuan, `FindingsCard` anchored `#temuan`), `components/app/findings-card.tsx`, `lib/coa/options.ts`
  (`openingTargetOptions`: balance-sheet accounts only; 3290 out of the review picker), `lib/findings.ts` refuses P&L targets.
  Tests: `tests/db/opening-controls.test.ts` (new), golden test's UC-B4 walk (T-001 for exactly Rp 60 jt → FAIL → decision → the key).
- T5: `lib/controls/completeness.ts` (six months up to the selected one; *before* until the account's books start — day after Saldo Awal, else its
  first statement; a handover compares a statement's opening with the closing of the last statement ending before it), `components/app/completeness-card.tsx`
  on Tutup Buku. Test: `tests/db/completeness.test.ts`.
- T6: `lib/workspace/index.ts` (`preliminary` on every answer read from the books while any client in scope has the month open, naming
  them when only some do; intent `change` — an instruction verb at the start and no question word — answers where the change is made),
  `components/app/workspace-ask.tsx` (*Sementara* pill). Tests: `tests/unit/workspace.test.ts`, `tests/db/workspace.test.ts`.
- T7: polish after looking at the pages — the Saldo Awal page names its open Temuan with a link, the completeness matrix drops months before
  any book starts, the Temuan form aligns its fields.
- Review (independent adversarial pass over the branch diff) found six defects, all fixed: `opening:` asked ledger-imported entities (whose
  Saldo Awal page offers no form) → skipped when the entity has IMPORTED entries; the change-request intent refused questions such as
  "Posting apa saja ke 6100?" → any question word or a trailing "?" keeps it a question; the completeness matrix compared only a month's first
  statement and compared files that overlap → every statement starting in the month is checked against its predecessor, overlapping ones
  are skipped (gaps are judged by balances, not dates: a file without a period line spans only its first to last row); the Neraca pill said
  "1 temuan terbuka" for a 3290 balance with no open Temuan → says *selisih saldo awal belum diputuskan*; the fixed-asset movement could
  link the resolution instead of the Saldo Awal (two OPENING entries on one date) → ordered by `createdAt`; two simultaneous Saldo Awal saves
  could post twice → re-checked under the client lock inside the transaction. Confirmed sound: signs, every OPENING reader, locks, tenancy,
  3290 placement in every statement, the golden key's independence.

## Verification
- T1: `npx vitest run tests/db/golden.test.ts` → `Tests 6 passed (6)`; gate: lint clean, typecheck clean, `npm test` → `Test Files 122 passed (122) · Tests 916 passed (916)`.
- T2: fresh `prisma migrate deploy` on both DBs → "All migrations have been successfully applied."; `prisma migrate diff --from-config-datasource --to-schema` →
  "This is an empty migration."; lint + typecheck clean; `npm test` → `Test Files 122 passed (122) · Tests 916 passed (916)`; `demo:reset && verify:books` →
  `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T3: `npx vitest run tests/db/opening.test.ts tests/db/findings.test.ts tests/db/opening-deposits.test.ts` → `Tests 9 passed (9)`; lint + typecheck clean;
  `npm test` → `Test Files 123 passed (123) · Tests 920 passed (920)`.
- T4: `npx vitest run tests/db/opening-controls.test.ts tests/db/golden.test.ts` → `Tests 9 passed (9)`; lint + typecheck clean; `npm test` →
  `Test Files 124 passed (124) · Tests 923 passed (923)`.
- T5: `npx vitest run tests/db/completeness.test.ts` → `Tests 1 passed (1)`; lint + typecheck clean; `npm test` → `Test Files 125 passed (125) · Tests 924 passed (924)`.
- T6: `npx vitest run tests/unit/workspace.test.ts tests/db/workspace.test.ts` → `Tests 21 passed (21)`; lint + typecheck clean; `npm test` →
  `Test Files 125 passed (125) · Tests 926 passed (926)`.
- After the review fixes: `npx vitest run` of the touched suites → `Tests 26 passed (26)`.
- T7 end of cycle (after the review fixes): lint clean; typecheck clean; `npm test` → `Test Files 125 passed (125) · Tests 929 passed (929)`; `npm run build` → "✓ Compiled
  successfully"; `demo:reset && verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- `npm run test:e2e` **not run here**: its global setup signs in through Supabase Auth, which this sandbox can't reach (no keys, no Docker daemon
  for a local stack), as in earlier cycles. CI runs it. Checked by reading every spec that touches the changed pages: no selector collides
  (the demo has no Temuan, the new texts don't repeat asserted strings, `getByLabel("Debit").first()` on Saldo Awal still finds the deposit row).
- Browser check (local only: the session read was stubbed to a member row, never committed, then reverted; the golden client with the petty
  cash left out seeded into the dev DB): Tutup Buku shows NextStep → T-001 open with its question → completeness matrix (Apr–Jun *Ada*) →
  `opening-diff:` *Gagal* naming T-001; Neraca shows *Selisih saldo awal belum diselesaikan (60.000.000)* on its own line, pill *Seimbang · 1
  temuan terbuka*, Draf bar naming T-001; Saldo Awal on a new client: bank 80.000.000 → 3290 row + notice, *Pakai selisih sebagai Saldo Laba*
  fills the line, saving with Saldo Laba 50.000.000 posts 30.000.000 to 3290 and toasts "temuan T-001"; resolving T-001 to 1110 with a written
  decision shows *Selesai* with the decision, the account, who and when, and the Neraca pill returns to *Seimbang*. 390 px: no horizontal
  scroll; no console errors.

## Ship Notes
- **Migration** `20261002160155_findings` (new table `Finding` + two enums + a CHECK). Additive; applied by `prisma migrate deploy` on deploy.
- **Behaviour change for the firm:** a Saldo Awal that doesn't balance no longer lands in 3200. It goes to 3290 Selisih Saldo Awal (created on
  first use for existing clients; part of the template for new ones) and blocks Tutup Buku until the Temuan is decided. A new client set up from
  bank statements alone gets one Temuan for its whole bank balance: answer it with Modal (3100) or Saldo Laba (3200) and a sentence why.
  Existing openings with a 3200 plug are unchanged (history is not rewritten).
- An entity whose books start in a month without any Saldo Awal gets one *Perlu dicek* in that month (cleared by a note).
- No env vars. Rollback: revert the merge; the `Finding` table can stay (nothing else reads it), 3290 lines already posted remain until
  reclassified by an Adjustment.
- Sandbox: `xlsx` came from the npm registry locally (the pinned `cdn.sheetjs.com` tarball is blocked); the lockfile is untouched.

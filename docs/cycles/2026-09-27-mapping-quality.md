# Mapping quality — the client's chart lands on the right lines

## Context
Client COA-first views (cycle 2026-09-27-client-coa-first-gl) made mapping mistakes visible. On real Chickin books
(707 client accounts, local `buku_real`): 186 accounts sit in catch-alls (6190 ×112, 2120 ×43, 1140 ×23, 4910 ×5,
3110 ×3) and a list is plainly on the wrong side — *Bank Charges* → 1120 Kas di Bank, *Prepaid Income Tax* → 4110
Pendapatan Jasa, *Depreciation – Office Equipments* → 1210 Aset Tetap, *Customer Deposits* → 1170 Uang Muka,
*Religious Festivity Allowance (THR)* → 1130 Piutang Usaha, *Deferred Expense* → 6190, *Beban Penyisihan Piutang* → 1130.
Goers: *Payable to Event* (Rp 39,9 M of customer funds) lumped into 2120.

Root causes (all in `lib/ledger-import/mapping.ts`):
1. `inferType()` lets weak name words (bank, deposit, equipment, allowance, "income" inside "Prepaid Income Tax") beat
   the client's own code scheme. Chickin's 6xxxx/7xxxx are expenses, but the rule guard sees ASET and the "bank" rule fires.
2. Generic rules (`expense|beban|biaya` → 6190, `payable|utang` → 2120, `piutang|receivable` → 1140,
   `income|revenue` → 4110/4910) turn the client's detail into one line. The accountant can already create a Buku account
   from the panel ("+ Buat akun baru"), but nothing suggests it.
3. The evidence (Drive/upload) handoff stages a draft without computing rule suggestions; they appear only after
   *Minta saran AI* (hard-test finding #1), and that click also spends AI on accounts rules could have covered.

Who feels it: the accountant mapping 700 accounts, and anyone reading a Laba Rugi where 112 accounts are "Beban umum
lain-lain". Outcome: suggestions land on the right side, keep the client's detail as Buku accounts when no specific
line fits, and are there the moment a draft opens. AI stays for the leftovers only.

## Spec
Type inference (`inferType` → `inferTypeWith(scheme)`)
- [x] **Evidence order:** Neraca section (file) › strong name words (expense/beban/biaya/cost/loss; revenue/income/pendapatan/
      penjualan/sales/gain; payable/utang/hutang/accrued/liabilit; receivable/piutang/prepaid/dibayar di muka; capital/modal/
      retained…, with today's exclusions plus *prepaid/tax article* excluding "income") › **the client's code scheme** ›
      weak name words (bank, cash, deposit, equipment, asset, allowance, inventory…) › leading digit as last resort.
- [x] **Code scheme learned per staging:** from the file's accounts that carry a strong signal, the majority type per
      leading digit (alpha prefixes stripped, e.g. `1-1000` → 1); a digit counts when ≥ 3 accounts agree ≥ 80 %. Stored
      `typeHint` uses the result, so the AI prompt (names + type hints) benefits too. Chickin: *Bank Charges* 76024 → BEBAN,
      *Customer Deposits* 21001 → LIABILITAS, *Prepaid – Income Tax* 13001 → ASET, *Depreciation – Equipments* 64003 → BEBAN.
- [x] Existing rule type guards then do the rest: the seven wrong-side examples above map to 7100, 1180, 6180, 2160, 6190→(new), 1170, 6190→(new).

No catch-all suggestions
- [x] A match on a **generic** rule only (`expense|beban|biaya`, `payable|utang|hutang`, `piutang|receivable|loan to`,
      `income|revenue|pendapatan`, `other income`) suggests a **new Buku account** named after the client account under
      the matching FS line (BEBAN_UMUM_ADM, UTANG_LAIN, PIUTANG_LAIN, PENDAPATAN_USAHA / PENDAPATAN_LAIN), method `NEW`,
      instead of 6190/2120/1140/4110/4910 — unless the client's name itself says *lain-lain / other / misc / sundry / lainnya*.
- [x] Suggestion storage without a migration: `suggestedCode = "new:<FS_LINE>"`, `suggestedBy = NEW`; the whitelist accepts
      only FS lines from `FS_LINES`; `acceptMappings` already handles `newAccount`. A name already created for another
      entity is reused by the existing PRIOR rule (one shared client chart, ADR 0006).
- [x] `createClientAccount` ranges hold ≥ 200 accounts per FS line (5-digit codes under the line's 4-digit prefix, e.g.
      6190 → 61901–61999 then 6191–6199), never a template or special code.

Suggestions always ready
- [x] `stageImport()` (both the manual and the evidence handoff paths) computes rule suggestions before returning; the
      panel opens with them. *Minta saran AI* asks only for accounts still without a suggestion.

Mapping panel (`components/app/mapping-panel.tsx`)
- [x] Header counts: rules · AI · new accounts to create · without suggestion; the bulk "Terima saran aturan" says how many
      accounts it will create. A row whose chosen target's type differs from the account's inferred type shows
      *Sisi akun berbeda* (review colour); a row pointed at a catch-all shows *akun penampung* with the new-account option.
- [x] NEW suggestions pre-select "+ Buat akun baru" with the FS line and the client's name filled in.

Verification
- [ ] `tests/db/mapping.test.ts` updated (generic rules → `{ method: "NEW", fsLine }`; specific rules unchanged) + new tests:
      scheme learning, weak-word vs scheme, Neraca section beats scheme, Drive handoff draft has rule suggestions.
- [ ] `scripts/verify-real.ts` prints mapping quality for Chickin and Goers: catch-all suggestions (target 0), accounts on
      the wrong side by code scheme (target: none of the seven above), new accounts proposed. e2e ledger-import walk
      updated if its mapping step changes.
- [ ] Accounting rules 9a: suggestions may propose a new client account; still nothing maps without the accountant's click.

**Gate-reopeners:** none — no migration (NEW suggestions ride in `suggestedCode` with a `new:` prefix), no dependency,
no AI change (AI only sees better type hints). Rule 9a wording extended, invariant unchanged.

**Non-goals:** re-mapping accepted mappings (Chickin/Goers in production stay until the accountant re-maps); changes to
the AI prompt or budget; a rules editor per client; automatic merging of similar client accounts; Neraca term hints
(done last cycle); the mapping panel's layout beyond the counts and warnings.

**Assumptions:**
1. "New account instead of catch-all" is right for every generic match, expenses and revenue included — the client's
   chart is the truth; 112 expense accounts become 112 Buku accounts under *Beban umum & administrasi*.
2. A code scheme is learned per file, not per client: an entity's chart can differ (HoldCo 41000 is an expense), and a
   file mixes entities only when they share a chart.
3. Strong name words beat the scheme ("41000 Expense Bank Administration" stays an expense); weak words lose to it.
4. Encoding NEW suggestions in `suggestedCode` is acceptable; a column can come later if the shape grows.
5. Existing behaviour for Neraca files (section type) is unchanged and outranks everything else.

## Tasks
- [x] T1 Type inference with a learned code scheme + tests — accept: the seven Chickin examples resolve in a unit test; `tests/db/mapping.test.ts` green (`inferType` expectations kept). Reuse `normName`, `inferType`.
- [x] T2 Generic rules → NEW suggestions, `new:<FS_LINE>` whitelist, wider `RANGES` + tests — accept: `suggestMappings` returns NEW for "Religious Festivity Allowance (THR)" and keeps 7100 for "Bank Charges"; `acceptMappings` creates the account. Depends T1.
- [x] T3 Suggestions at staging for both paths + panel counts/warnings/NEW pre-selection — accept: DB test on the evidence handoff draft; browser check on local real Chickin draft at desktop + 390 px; e2e green. Depends T2. Load `ui-rules`.
- [ ] T4 `verify-real` mapping-quality report, run on real files; end-of-cycle gates — accept: 0 catch-all suggestions, none of the seven on the wrong side; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline in worktree `../native-erp-v2-mapping` (branch `task/mapping-quality`) — the main checkout is in use by another session.
- T1: `lib/ledger-import/mapping.ts` — `STRONG` / `WEAK` name evidence, `strongType`, `codeDigit`, `learnScheme` (majority type per leading digit, ≥ 3 votes ≥ 80 %), `inferType(code, name, scheme?)` in the order strong → scheme → weak → digit. Strong order: expense (excl. prepaid/accrued/payable/deferred), depreciation (excl. accumulated), payable (+ customer deposits), receivable/prepaid, revenue (excl. article/pph/prepaid), rent/pay, capital. Bare `utang` in exclusions had matched inside "pi**utang**" — word-bounded now. Rules: prepaid-tax matches "Prepaid … Tax/Article", "deferred expense" → 1170. `lib/ledger-import/post.ts` learns the scheme per staged file, stores the type on new source accounts and refreshes it on unmapped existing ones (accepted mappings untouched). Tests: `tests/db/mapping.test.ts` (scheme + the seven Chickin examples; all prior expectations kept).- T2: `lib/ledger-import/mapping.ts` — `generic` marker on the five catch-all rules (1140 → PIUTANG_LAIN, 2120 → UTANG_LAIN, 4110 → PENDAPATAN_USAHA, 4910 → PENDAPATAN_LAIN, 6190 → BEBAN_UMUM_ADM); a generic-only match returns `new:<FS_LINE>` / method `NEW` / 0.7 unless the name is itself a catch-all (`lain-lain`, `other`, `misc`, `sundry`, `umum`, `general`); `NEW_PREFIX`, `newFsLineOf()` whitelist against `FS_LINES` + `RANGES`; `acceptMappings` turns an accepted `new:` code into a created account named after the client's account; `createClientAccount` continues past a full 4-digit range with `<anchor>01…99` (1140 → 114001…, text-sorted right after the anchor). Tests updated (four `1140` expectations → `new:PIUTANG_LAIN`) + new cases (generic → NEW, catch-all names stay, `new:` accept, invalid line refused, 11 accounts past the 9-slot range).
- T3: `lib/ledger-import/post.ts` — `stageImport` ends with rule-only `suggestMappings` (manual upload and evidence handoff alike); the duplicate call in `stageLedgerAction` removed. `components/app/mapping-panel.tsx` — `NEW` counts as a rule suggestion; `new:<FS_LINE>` pre-selects "+ Buat akun baru" with the line and the client's name; bulk button says "(membuat K akun baru)"; counts line `aturan · akun baru · AI · tanpa saran`; per-row *Sisi akun berbeda* (chosen account's type ≠ the file's type, from the option group) and *Akun penampung* nudge. Type inference: "Accumulated Depreciation/Amortization…" is a strong contra-asset signal ahead of the rent/expense lines (a real row read "Rent Office" as an expense). Test: a freshly staged draft carries suggestions with 0 AI usage.

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 52 passed (52), Tests 382 passed (382).
- T2: lint + typecheck clean; `npm test` → Test Files 52 passed (52), Tests 383 passed (383).
- T3: lint + typecheck clean; `npm test` → Test Files 52 passed (52), Tests 384 passed (384). Browser (worktree dev server :3002, local demo DB, real Chickin `20_OPCO_GL_MASTER` staged): draft opens with "Terima 675 saran aturan (membuat 125 akun baru)", counts "aturan 550 · akun baru 125 · AI 0 · tanpa saran 16", NEW rows pre-filled (e.g. 11102 Trade Receivable – Related Parties → + Buat akun baru · Piutang lain-lain), 8 catch-all nudges on the first page, 1 wrong-side flag (the contra-asset false positive, fixed); 390 px: no page overflow. The 47 remaining catch-all suggestions are all catch-all names (Other/Lainnya/General), the specific "Short Term" rule, or APIC → 3110.
## Ship Notes

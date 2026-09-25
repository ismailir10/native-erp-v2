# Currency-aware amounts in Jurnal Penyesuaian and Saldo Awal

## Context
Money is bigint **minor units of the entity's functional currency** (ADR 0002 / 0006, accounting-rules §6). The two
hand-typed posting flows ignore that: Jurnal Penyesuaian (`adjustmentAction`) and Saldo Awal (`postOpening` in
`lib/opening.ts`) parse with `parseRupiah`, which returns whole units. For an SGD entity (exponent 2), typing `100` posts
`100n` = **S$1.00** instead of S$100.00. Totals in both forms and the Saldo Awal bank prefill use `formatRupiah`, so the
screen also lies (`Rp`-style, no decimals).

A second, latent bug: `OpeningForm` turns each parsed bank balance back into `String(v)` (minor units) before sending it.
Once the server parses **major** units, that would scale non-IDR bank lines by 100 again. It has to send a formatted
major-unit string instead.

Who feels it: an accountant keying adjustments or opening balances for a non-IDR entity (e.g. Chickin's SGD HoldCo on the
real-data preview). The books are silently wrong by ×100 and nothing flags it. Outcome: a typed `100` means 100 units of the
entity's currency, everywhere, and the screen shows it in that currency.

Found during the 2026-09-25 UI audit (`docs/cycles/2026-09-25-ui-audit-one-workspace.md`, "Follow-ups found"; its Ship
Notes ask to avoid non-IDR adjustments on real data until this is fixed).

## Spec
- [ ] `parseMoney(input, currency)` in `lib/money.ts`: a typed **major-unit** amount in Indonesian notation → bigint minor units via `exponentOf`. No `Number`/`parseFloat`.
  - Accepts `""`/whitespace (→ `0n`), `100`, `1500000`, `1.500.000`, `1.500.000,50`, `12.500,00`, `-1.234`, `(1.234)`, and an optional leading symbol/code of **that** currency (`Rp`, `Rp.`, `IDR`, `S$`, `SGD`…).
  - Dot = thousands grouping, only in groups of 3 (`1.500.000`). Comma = decimal separator.
  - Fraction digits beyond the currency exponent are accepted only if they are zeros (`12.500.000,00` IDR → `12500000n`); otherwise rejected, never rounded.
  - Rejects with a typed `MoneyError` (Bahasa message): letters, `1.5`, `100.50`, `1500.000`, `1,234,567`, `1,2,3`, `--1`, `,`, a symbol of a different currency, `100,5` for IDR, `1,005` for SGD.
- [ ] Round trip: `parseMoney(formatMoney(v, c, { bare: true }), c) === v` for IDR, SGD, USD, JPY, incl. negatives.
- [ ] Jurnal Penyesuaian: server resolves the entity's `functionalCurrency` itself (never trusts the client) and parses every line with `parseMoney`. Logic moves out of `adjustmentAction` into `postAdjustment()` in `lib/ledger/adjustment.ts` so a DB test can reach it; the action keeps tenancy (`getClientForFirm`) and calls it.
- [ ] Saldo Awal: `postOpening` parses with `parseMoney(…, entity.functionalCurrency)`; its "can't read" message gives an example in that currency.
- [ ] `fail()` in `app/actions.ts` shows `MoneyError` messages verbatim.
- [ ] `JournalForm`: entities carry `currency`; totals and the *Selisih* pill use `formatMoney` in the selected entity's currency. An unparseable field is marked `aria-invalid` and disables *Simpan jurnal*.
- [ ] `OpeningForm`: gets `currency`; bank lines are sent as `formatMoney(|v|, currency, { bare: true })`, not `String(v)`; the 3200 plug row uses `formatMoney`; invalid fields marked and block *Simpan*. Amount inputs use `inputMode="decimal"` so a phone keyboard offers the comma.
- [ ] Opening page prefills bank lines with `formatMoney(statementOpening, currency, { bare: true })`. (*Terakhir dicatat* on the journal page already renders `Money` in the entry's entity currency since the UI-audit cycle; no change.)
- [ ] Unit tests: IDR (exp 0), SGD and USD (exp 2), JPY (exp 0), malformed input, round trip.
- [ ] DB tests: SGD entity: `postAdjustment` with `100` / `12,34` posts `10000n` / `1234n`; `postOpening` with `1.000,00` posts `100000n` and the 3200 plug in cents; IDR opening test unchanged (`50.000.000` → `50_000_000n`).
- [ ] Gates: lint, typecheck, test, build, `verify:books` ALL PASS, `test:e2e` green. Draft PR to `staging`.

**Non-goals:** bank-statement and ledger-file parsers (`parseRupiah` / `parseCents` / `parseMinor` stay as they are; they read
machine output in several notations); foreign-currency lines inside a manual journal (`currency`/`fxAmount`/`fxRate`);
changing how existing entries are stored; a data fix for any SGD adjustment/opening already posted on the preview (see
Assumption 4).

**Gate-reopeners:** none. No schema migration, no new dependency, no AI calls. Invariants unchanged: amounts still go
through `postJournal()` as bigint minor units. This cycle makes the two typed flows obey rule 6.

**Assumptions:**
1. Typed amounts are **Indonesian notation only**. For IDR this is stricter than today: `parseRupiah` accepted `1,234,567.00` and `1500000.00`; `parseMoney` rejects them with a clear message rather than guess. Plain digits and `1.500.000` still work.
2. Too many non-zero decimals are **rejected**, not rounded (`1.000,50` for IDR). Rounding with a 7190 residue (rule 6a) applies to imported source amounts, not to what an accountant types.
3. Negative input stays allowed in the parser (overdraft bank balance in Saldo Awal). A negative debit/credit in a journal is still refused by `postJournal` as today.
4. No SGD adjustment/opening has been posted yet in any environment that matters. If one has, it needs a correcting entry by hand. This cycle doesn't hunt for them.
5. The e2e investor walk (IDR demo firm) keeps passing unchanged. No new e2e step for SGD, since the DB tests cover posting and the demo has no non-IDR entity.

## Tasks
- [x] T1 `parseMoney` + `MoneyError` in `lib/money.ts` (reuse `exponentOf`, `CURRENCIES`) + unit tests. Accept: `npm test -- money` green with IDR/SGD/USD/JPY/malformed/round-trip cases.
- [x] T2 Server side: `postAdjustment()` in `lib/ledger/adjustment.ts`; `adjustmentAction` delegates; `postOpening` uses entity currency; `fail()` maps `MoneyError`. DB tests for SGD adjustment + SGD opening (depends T1). Accept: `tests/db/adjustment.test.ts` + `tests/db/opening.test.ts` green.
- [x] T3 UI: `JournalForm`, `OpeningForm`, opening page prefill are currency-aware, and invalid fields are marked and block save (depends T1, T2). Accept: typecheck; manual check in dev with an entity switched to SGD: typing `100` shows total `100,00`, the *Selisih* pill in `S$`, and posts `10000n`.
- [ ] T4 End-of-cycle gates + Verification section filled with real output tails (depends T1–T3). Accept: build, `verify:books` ALL PASS, `test:e2e` green.

## Implementation
- Plan: tasks [T1, T2, T3, T4] sequential, done inline (each depends on the previous; small slices, no parallelism to gain). Branch `codex/currency-aware-manual-amounts` from `origin/staging` (local staging was 10 commits behind; re-read the drifted form files after rebasing the plan).
- T1: `lib/money.ts`, `tests/unit/money.test.ts`: `parseMoney(input, currency)` (strict id-ID notation → minor units via `exponentOf`, BigInt only), `MoneyError`, `moneyExample(currency)` for hints/messages. Existing `parseRupiah`/`parseCents`/`parseMinor` untouched.
- T2: `lib/ledger/adjustment.ts` (new `postAdjustment()`: entity looked up by `clientId`, currency from `entity.functionalCurrency`, `parseMoney` per line, `postJournal` in one transaction), `app/actions.ts` (`adjustmentAction` = tenancy + delegate; `fail()` maps `MoneyError`), `lib/opening.ts` (`parseMoney` in entity currency; the generic "tidak bisa dibaca" `OpeningError` is replaced by `MoneyError`'s message with a currency-specific example), `tests/db/adjustment.test.ts` (new), `tests/db/opening.test.ts` (SGD case).
- T3: `components/app/journal-form.tsx` (entities carry `currency`; `parseMoney` per field, totals / *Selisih* via `formatMoney`, `(SGD)` in the column headers for non-IDR, `aria-invalid` + the Bahasa reason under the table, save blocked while any field is unreadable, `inputMode="decimal"`, placeholder `0` / `0,00`), `components/app/opening-form.tsx` (`currency` prop; bank lines sent as `formatMoney(|v|, currency, { bare: true })` instead of raw minor units; plug via `formatMoney`; same invalid-field handling; placeholder via `moneyExample`), `app/(app)/clients/[id]/opening/page.tsx` (prefill + currency via `formatMoney`), `app/(app)/clients/[id]/journals/new/page.tsx` (passes `functionalCurrency`). The preview pane couldn't start the dev server here (`EPERM: operation not permitted, uv_cwd`, a macOS folder permission on the pane's launcher), so the UI check used a throwaway Playwright spec (not committed) against `next start`, with a synthetic SGD client made through `addClient`.
## Verification
- T1 gate: lint clean, typecheck clean, `Test Files  43 passed (43)` / `Tests  344 passed (344)` (money.test.ts: 63).
- T2 gate: lint clean, typecheck clean, `Test Files  44 passed (44)` / `Tests  348 passed (348)`. New: SGD `100` → `10000n`, `12,34` → `1234n`; SGD opening `1.000,00` / `250,5` → `100000n` / `25050n`, plug 3200 `74950n`.
- T3 UI check (throwaway Playwright spec on the production build, SGD client *Uji SGD Pte*): headers `Debit (SGD)`; `1,005` → alert "…paling banyak 2 angka di belakang koma…", field `aria-invalid="true"`, *Simpan jurnal* disabled; 100 vs 90 → pill `Selisih S$ 10,00`; 100 vs 100 → `Seimbang`, saved. Saldo Awal placeholder `Saldo di bank, mis. 1.250,50`; `1.000,00` → plug row `1.000,00`, saved. DB after: `[{"kind":"OPENING","lines":[["1101","100000","0"],["3200","0","100000"]]},{"kind":"ADJUSTMENT","lines":[["6180","10000","0"],["1219","0","10000"]]}]` → `1 passed`.
- T3 gate: lint clean, typecheck clean, `Test Files  44 passed (44)` / `Tests  348 passed (348)`.
## Ship Notes

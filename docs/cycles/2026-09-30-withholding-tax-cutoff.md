# Withholding tax and tax cut-off (Cycle 2b)

## Context
An Indonesian-accounting review found four places where Buku books tax in a way an accountant would correct by hand. Each was checked
in the code first:

1. **Withholding (PPh 23 / 22 / 4(2) / 21) is not modelled — real.** `createInvoice` posts a sales invoice at gross (Dr 1130 / Cr revenue +
   2130) and a settlement is a subledger link to a bank line classified to 1130 for the *bank* amount. A customer that pays 10.900.000
   against an invoice of 11.100.000 (PPh 23 200.000 withheld) leaves 200.000 open on the invoice and in 1130 forever, and the prepaid tax
   (1180) is never booked. `splitPpn` (`lib/ledger/bank.ts`) knows PPN only. On the payment side (rent, services) the entity that
   withholds pays the counterparty net and DJP separately; without a liability leg the payable/lease liability stays open by the
   withheld part, so `ap:` and `lease:` sit in REVIEW for good.
2. **Tax-payment rules — real, with a caveat.** `PPH 21` remittance files to 6100 (salary expense): December's PPh 21 paid in January
   lands in the wrong year. No rule exists for PPh 23, PPh 4(2)/final, PPh 29, `PPN` variants, and `BEA METERAI` (the existing rule spells
   `MATERAI`), so they fall to 6190/1999. Caveat: a remittance debited to 2140/2141/2145 shows a *debit* balance on that liability until
   the withholding itself is booked (payroll, or the withholding option below); the existing sanity control "Saldo berlawanan dengan sifat
   akun" then asks the accountant for it. That is the intended prompt, not a bug.
3. **PPh 25 by bank date — real.** `taxPack` credits instalments by `BankTransaction.date`; December's instalment is paid by 15 January and
   lands in the next year's credit.
4. **Disposal and capex cash flow — real.** A disposal entry (kind ADJUSTMENT, no bank row) crosses sections, so the cash-flow code moves the
   asset's investing part to "Transaksi non-kas" in operating: cost 120 jt / acc. dep. 90 jt / sold 40 jt shows +40 jt *operating* and 0
   investing. A purchase invoice for equipment is non-cash the same way, and the payment of its payable moves only the payable (operating).
   Totals still equal the Neraca cash change; the presentation is wrong.

Who feels it: the accountant closing a real client, and the person reading the cash flow and the PPh badan credits.

## Spec
**Item 2 — tax payment rules**
- [ ] `PPH 21` OUT → 2140 (tag PPH_21). New firm rules: `PPH 23` → 2141 (PPH_23); `PPH 4(2)`, `PPH 4 (2)`, `PPH 4 AYAT 2`, `PPH FINAL` → 2145
      (PPH_4_2); `PPH 29` → 2146; `PPH 25` stays 1180 (PPH_25); `SETOR PPN`, `PAJAK PPN`, `PPN MASA` OUT → 2130 like `SETORAN PPN`;
      `METERAI` → 7100. `PAJAK BUNGA`/`TAX ON INTEREST` (priority 10) still win.
- [ ] A rule whose account is not in the client's chart is skipped (the line goes on through memory / AI / heuristic), never crashing an import.
- [ ] Data migration adds the new rules for existing firms and repoints the firm's own SEED `PPH 21` rule from 6100 to 2140; lines already
      classified stay as they are.
- [ ] The demo scenario and its ground truth follow (PPh 21 remittance → 2140, with an opening payable so the liability is not debit).

**Item 1 — withholding**
- [ ] `WithholdingKind` (PPH_21, PPH_22, PPH_23, PPH_4_2). Bank line gets `whtKind` + `whtAmount`: the withheld part of the *classification
      side*. IN (customer withholds from us): Dr 1180 (PPh 22/23) or 8200 (PPh 4(2) is final, not creditable); OUT (we withhold): Cr 2140 / 2141 /
      2145. `postBankTransaction` posts and reclasses it (bank side never changes, rule 3).
- [ ] Invoice gets optional `whtKind` + `whtAmount` (typed as a rate on DPP or an amount). The receivable/payable and total stay gross.
- [ ] `InvoiceSettlement.amount` = what the settlement clears on the invoice (gross); new `withheld` = the part of it that is tax, not cash. A
      settlement that closes the invoice books the expected withholding by default (override possible); open amount, aging, CKPN and the
      `ar:`/`ap:` controls are unchanged in form (Σ amount). A bank line's free amount = |amount| − Σ (amount − withheld).
- [ ] Scenario (a): DPP 10.000.000 + PPN 1.100.000, customer pays 10.900.000: Dr Bank 10.900.000, Dr 1180 200.000 / Cr 1130 11.100.000;
      receivable 0. Scenario (b): rent 50.000.000, PPh 4(2) 10 %: Dr expense 50.000.000 / Cr Bank 45.000.000 / Cr 2145 5.000.000, then the
      remittance Dr 2145 / Cr Bank 5.000.000 leaves 2145 at 0. A lease payment with the option keeps 2170 equal to the register.
- [ ] UI: the settle dialog shows the withholding (kind, rate or amount) for a receipt/payment; the invoice form has the optional fields; the review
      queue offers the option on a bank line (rent, services). Minimal, shadcn components already in use.

**Item 3 — PPh 25 by masa pajak**
- [ ] `BankTransaction.taxMonth` (nullable date, first of the tax month). A line tagged PPH_25 gets payment month − 1 when it is classified
      (import, review) and none is set. The tax pack credits instalments by `taxMonth` (a legacy line without one: bank date, so existing
      numbers do not move). The pack's credit list shows the masa and lets the accountant change it.
- [ ] 12 instalments January–December of Y, December paid on 14 January Y+1: year Y credits = 12 instalments; the Y+1 pack excludes it.

**Item 4 — cash flow**
- [ ] A disposal entry shows its collected proceeds under investing ("Hasil pelepasan aset tetap"), the rest as non-cash in operating; proceeds still
      receivable at the period end are not investing yet. Cost 120 jt / acc. dep. 90 jt / sold 40 jt → +40.000.000 investing, and total = change of Neraca cash.
- [ ] Equipment bought by a purchase invoice (payable) and paid by bank lines settled to it shows the paid part under investing (outflow)
      instead of operating, also when the invoice is from the previous year.

**Non-goals:** withheld PPh 23/22 from sales invoices does not enter the tax pack's credits automatically (the accountant still types the bukti
potong — no double count); no payroll module (PPh 21 accrual stays manual); capex on a payable without an invoice link (a typed journal) stays as
it is; a disposal's proceeds collected in a later year stay in operating that year (the collection has no link to the disposal); no change
to numbers of existing bank lines or entries; no new dependency.
**Gate-reopeners:** schema migrations (additive, defaults safe, applied to production automatically) and a data migration of firm rules.
**Assumptions:**
1. PPh 4(2) on *our* income (rent received, construction) is final: Dr 8200 Beban Pajak Final, not 1180 (the brief listed it with the credits; a
   final tax is no credit against PPh 29).
2. The default tax month is stored when a line is classified, not derived at read time, so lines already in books keep their attribution.
3. A remittance rule to a liability leaves that liability debit until the withholding is booked; that is flagged by an existing control, not hidden.
4. Missing template accounts (2141, 2145, 1180, 8200) are created on first use through `templateAccounts` when a withholding is booked (same as the tax pack).

## Tasks
- [x] T1 Tax payment rules + skip a rule with no account in the client's chart + data migration + demo truth — accept: unit + DB tests, ALL PASS
- [x] T2 Withholding on the bank split (schema, `postBankTransaction`, review) — accept: scenario (b) and lease test
- [x] T3 Withholding on invoices and settlements (schema, create, settle, unsettle, free amounts) — accept: scenario (a), `ar:`/`ap:` PASS
- [x] T4 UI for withholding (invoice form, settle dialog, review) — accept: typecheck, lint, screenshot of the settle dialog
- [x] T5 PPh 25 masa pajak (schema, default at classification, pack query, edit in the pack) — accept: 12-instalment test
- [x] T6 Cash flow: disposal proceeds and capex on payable in investing — accept: 120/90/40 test, Neraca reconciliation holds
- [x] T7 Docs (accounting-rules, README) and end-of-cycle gates — accept: gates pasted below

## Implementation
- Plan: tasks T1–T7 sequential, done inline (each touches files the next reads; no independent slice worth a subagent).
- T1: `lib/classify/rules.ts` (new rules, `matchRule(..., codes)` skips a rule with no account in the chart), `lib/import/pipeline.ts`,
  migration `20260930050000_tax_payment_rules` (repoints the untouched seed `PPH 21` rule to 2140, inserts the rest per firm where absent),
  `lib/demo/scenario.ts` (PPh 21 truth → 2140; opening 2140 payable so the liability is not debit), tests `tests/unit/import.test.ts`,
  `tests/db/tax-rules.test.ts` (import fallback + the migration SQL run twice).
- T2: migration `20260930050100_bank_withholding` (enum `WithholdingKind`, `BankTransaction.whtKind/whtAmount` + CHECK), `lib/tax/withholding.ts`
  (accounts per kind and direction, rate → amount half up), `lib/ledger/bank.ts` (`classificationNets` with the tax leg; the leg's account is created
  on first use through `templateAccounts`), `lib/review.ts` (`withholding` arg: undefined keeps, null removes; kept through a change of account),
  `lib/coa/template.ts` (`FINAL_TAX` 8200), tests `tests/unit/withholding.test.ts`, `tests/db/withholding.test.ts` (rent, reclass, receipts, lease control).
- T3: migration `20260930050200_invoice_withholding` (`Invoice.whtKind/whtAmount`, `InvoiceSettlement.withheld`, CHECKs), `lib/receivables/invoices.ts`
  (rate or amount, validated), `lib/receivables/settle.ts` (settlement `amount` = gross cleared, `withheld` = tax part; default = the shortfall when it closes the
  invoice within the expected tax; tax leg posted through `setWithholdingTx` on the bank line; unsettle takes it back; a bank line's free amount = |amount| − Σ cash),
  `lib/review.ts` (`setWithholdingTx`; a line's settlement-owned withholding can't be edited by hand), `aging.ts`/`view.ts` (free amounts). Open amount, aging and CKPN
  keep Σ `amount`, now gross, so they and `ar:`/`ap:` needed no change. Test `tests/db/invoice-withholding.test.ts` (scenario (a), purchase side, partial/unsettle, checks).
- T4: `components/app/receivables.tsx` (invoice form: kind + rate or amount with the computed tax; settle dialog: kind + per-receipt "Dipotong", prefilled with the shortfall
  when it is within the expected tax; invoice detail shows expected tax and each settlement's tax part), `components/app/ledger-table.tsx` (drawer *Ubah akun*: "Pajak yang dipotong"
  + amount for any bank line — rent, services; this is where a payment without an invoice gets the option), `app/actions.ts` (`reviewAction` withholding, `settleAction`),
  `lib/receivables/{aging,view}.ts`, `lib/reports/account-ledger.ts`, `e2e/receivables.spec.ts` (a PPh 23 invoice on the fresh e2e client). The review queue itself is unchanged:
  its keyboard flow stays one decision per card; the option is one *Ubah akun* away (a follow-up if accountants want it inline).
- T5: migration `20260930050300_tax_month` (`BankTransaction.taxMonth` date, nullable, no backfill), `lib/tax/masa.ts` (`defaultTaxMonth`), `lib/import/pipeline.ts` and `lib/review.ts`
  (stored when a line is classified as PPh 25; cleared when it isn't), `lib/tax/pack.ts` (instalments by `taxMonth`, a line without one by bank date; `Credit.masa`),
  `lib/tax/records.ts` (`setTaxMonth`: not after the payment month, refuses when December of the year it leaves or joins is locked), `app/actions.ts`, `lib/tax/view.ts`,
  `components/app/tax-pack.tsx` (month input on each PPh 25 credit). Test `tests/db/tax-month.test.ts` (12 instalments, December paid 14 January).
- T6: `lib/reports/statements.ts` (`cashFlow`: a disposal entry of the register moves the collected proceeds to investing "Hasil pelepasan aset tetap" and the rest to a non-cash
  operating line; proceeds still on the receivable at the period end are not investing yet; a purchase bill's paid part (settlements dated in the period, also for an earlier
  year's bill) moves from operating to investing; both are zero-sum reclassifications, so the total is still the Neraca cash change). Test `tests/db/cashflow-investing.test.ts`
  (120/90/40, partial collection, early period, capex paid in the year and the year after; each checks the reconciliation with the Neraca).
- T7: `.agents/skills/accounting-rules/SKILL.md` (5h, 13a, updates to 1 and 5d), `README.md`.
- Findings against the advisor's list: all four defects were real (see Context). Deviations: PPh 4(2) on our own income goes to 8200 (final), not 1180; the
  review queue has no inline withholding (it is on *Ubah akun* and in the settle dialog); a disposal's proceeds collected in a later year, and capex on a payable
  without an invoice, stay in operating (no link to follow).

## Verification
End-of-cycle gates on branch `task/withholding-tax-cutoff` (dev and test databases migrated with `prisma migrate deploy`):

```
$ npm run lint            → eslint: no output (clean)
$ npm run typecheck       → ✔ Generated Prisma Client (7.10.0) … ; tsc --noEmit: no errors
$ npm test                →  Test Files  100 passed (100)
                              Tests  659 passed (659)
$ npm run build           → next build completes (route table printed, no errors)
$ npm run demo:reset      → Demo admin siap: dev@buku.local (ADMIN, KJA Demo & Rekan)
$ npm run verify:books    → ALL PASS — 1717 pemeriksaan saldo cocok dengan ground truth.
$ npm run test:e2e        →  24 passed (1.1m)
```
New tests: `tests/unit/import.test.ts` (tax payment rules), `tests/unit/withholding.test.ts`, `tests/db/tax-rules.test.ts`, `tests/db/withholding.test.ts`,
`tests/db/invoice-withholding.test.ts`, `tests/db/tax-month.test.ts`, `tests/db/cashflow-investing.test.ts`, and a PPh 23 invoice step in `e2e/receivables.spec.ts`.

## Ship Notes
**Migrations (all additive, applied to production by the deploy; timestamps after the reporting-framework PR's 20260930030000 / 20260930040000):**
- `20260930050000_tax_payment_rules` — data: inserts the new firm rules per firm where absent; repoints an untouched SEED `PPH 21` rule 6100 → 2140. Applies to new imports only.
  Rollback: `DELETE FROM "Rule" WHERE "source"='SEED' AND "pattern" IN (…the new patterns…)` and `UPDATE "Rule" SET "accountCode"='6100' WHERE "source"='SEED' AND upper("pattern")='PPH 21' AND "accountCode"='2140'`.
- `20260930050100_bank_withholding` — enum `WithholdingKind`; `BankTransaction.whtKind` (null), `whtAmount` (0) + CHECK. Rollback: drop the two columns and the constraint, then the enum.
- `20260930050200_invoice_withholding` — `Invoice.whtKind`/`whtAmount`, `InvoiceSettlement.withheld` (0) + CHECKs. Rollback: drop those columns and constraints.
- `20260930050300_tax_month` — `BankTransaction.taxMonth` (null, no backfill). Rollback: drop the column.
Code rollback = revert the merge; existing rows keep their defaults, so no data depends on the columns until a user enters a withholding or a masa.

**No env vars, no manual steps, no AI use, no new dependency.** Existing numbers do not change: rules apply to new imports, legacy PPh 25 lines count by bank date, invoices and
settlements default to nothing withheld, and the cash-flow change only affects disposals and paid capex bills (presentation; totals unchanged).
**Follow-ups:** inline withholding in the review queue; masa pajak and withheld tax in the Excel kertas kerja; collecting a disposal's proceeds in a later year in investing.

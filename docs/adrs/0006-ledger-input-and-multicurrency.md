# 0006 — Ledgers and Neraca as input; per-entity source accounts; functional currency per entity (2026-09-24)

Updates the scope of [0004](0004-wedge-and-scope.md) and the money rule of [0002](0002-money-and-ledger.md).

**Context.** The first real test cases were not single-account IDR bank statements. Chickin is a group rebuild workbook
(monthly/yearly ledger totals, five companies, each with its own account codes, a Singapore HoldCo keeping SGD books with USD and
SGD banks). Goers only has Jurnal (Mekari) exports of Neraca / Laba Rugi. An SMBC PDF holds several accounts in one statement,
including an overdraft (PRK) account. Firms receive all three kinds of files; many clients already keep books in Jurnal, Accurate
or Excel, and some have foreign parents.

**Decision.**
1. **Input = bank statements + ledgers (GL) + Neraca / Neraca Saldo.** Ledger files go read → check → map → post, all-or-nothing,
   through `postJournal()`. Every ledger-derived entry keeps `ledgerImportId` + `sourceRef` (`sheet!row`) the way bank-derived entries
   keep `bankTransactionId`.
2. **Client chart + per-entity source accounts.** The client chart stays shared by its entities (combined view lines up). Each entity's
   own codes live in `SourceAccount`, mapped to one client account; imported lines keep `sourceAccountId`, so an entity's TB can be shown
   in its own accounts. Mapping suggestions (rules, then AI on names only) are never applied without the accountant.
3. **Source checks before posting.** Deterministic BLOCK / REVIEW / INFO checks with exact row references. An unbalanced source group is
   blocked; the accountant may accept it, which posts the difference to 1999 (visible, REVIEW until fixed). No silent plugs.
4. **Functional currency per entity.** `JournalLine.debit/credit` are bigint **minor units of the entity's functional currency**
   (IDR exponent 0 = whole Rupiah, so existing data is unchanged). Foreign-currency lines keep `currency`, `fxAmount`, `fxRate`.
   IDR amounts with sen round half-up per line; the entry's residue goes to **7190 Selisih Pembulatan**.
5. **Rates are data, not a feed.** `ExchangeRate` rows are typed in or taken from the imported file. Month-end revaluation of monetary
   foreign-currency balances is *proposed* to 7200 and posted only by a click.
6. **Combined view in IDR.** Non-IDR entities are translated for Gabungan / Beranda: assets & liabilities at closing rate, income &
   expense at the period's average rate, equity at historical rate, the residue shown as "Selisih penjabaran mata uang asing". Still a
   management view, not SAK consolidation. Missing rate → "belum dijabarkan", never a wrong number.

**Consequences.** Buku can be tested on real books without new client files, and a firm can onboard a client mid-year from its existing
system. Reports must be currency-aware (format by currency, translate across entities). Foreign-currency bank statements, live rate
feeds, intercompany reconciliation between separate companies and SAK consolidation remain out of scope.

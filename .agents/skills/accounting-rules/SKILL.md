---
name: accounting-rules
description: Non-negotiable accounting invariants for Buku's ledger, import pipeline, classifier, AI usage, reports and close controls. Load before touching lib/ledger, lib/import, lib/ledger-import, lib/fx, lib/classify, lib/ai, lib/reports, lib/controls or prisma/.
---

# Accounting rules (break one = a bug, even if tests pass)

Lineage: these come from the one-time chickin/belifi reconciliation work (bank mutation → GL → TB → FS,
"GL = single source of truth, no hidden plugs, 3-layer verification") turned into a product.

## Ledger
1. **GL is the single source of truth for Buku books.** Never store derived ledger balances. Versioned source-reported figures in `lib/evidence/` are evidence, explicitly labeled separately, and never feed Buku financial reports directly (ADR 0007). TB, Laba Rugi, Neraca, combined worksheet,
   charts and tax card are all derived from `JournalLine` at read time (`lib/reports/*`). So are the other comprehensive income (movement
   of the PKL equity lines), the changes in equity and the indirect cash flow (`lib/reports/statements.ts`: every balance-sheet account's
   movement, classified by FS line — leases, employee benefits and deferred tax by code; single-currency scopes), whose opening is 31
   December plus the year's Saldo Awal (kind OPENING) entries — never a flow — and each is checked against the Neraca. CALK and the Excel
   set (`lib/reports/notes.ts`, `workbook.ts`) reuse those functions and the registers; notes are never stored. In the cash flow a register disposal's **collected** proceeds and the paid part
   of a purchase bill's investing debit (by the cash of its settlements, i.e. less the tax they withheld; any year) are investing; the rest of those entries is a non-cash operating line, so the sections still add up to the Neraca's change in cash.
   `Entity.reportingFramework` (SAK EMKM / EP / Umum, default EP; a group takes the most demanding) decides **wording only** — the standard the CALK
   names, statement titles, which policies are described (EMKM has no PSAK 109 matrix, right-of-use, deferred tax or OCI wording) and
   who signs (Direksi for PT / foreign, Pemilik/Pengurus for CV / individual) — through `lib/reports/framework.ts`; no figure may depend on it.
2. **`postJournal()` (`lib/ledger/post.ts`) is the only writer.** It enforces Σdebit = Σcredit, ≥2 lines,
   one positive side per line, open period, accounts in the entity's client COA. The DB also CHECKs
   `debit>=0, credit>=0, (debit=0) <> (credit=0)` (init migration). Never `prisma.journalLine.create` elsewhere.
   A bank GL account belongs to one entity (`BankAccount.entityId`): another entity's entry may not use it — money between
   entities goes through 1190 in each entity's own books (rule 10). The only exception clears what older books left there (a
   line moving that entity's balance on the account toward zero); close control `bank-entity:` (REVIEW) shows such leftovers.
3. **Posted entries are immutable.** Corrections = new entry. Bank lines change via `postBankTransaction()`,
   which posts a **RECLASS of the difference** on the classification side only; the bank side never changes.
4. **Locked periods reject every write** — imports, reclasses, adjustments. Closing goes in order: a month can't be locked while an earlier
   month with entries other than the Saldo Awal is open (`lockPeriod`, checked again under the client lock). Unlock (`unlockPeriod`) is
   explicit, **ADMIN only**, needs a reason (≥ 5 characters), runs in reverse order (refused while a later month is locked) and writes a
   `PeriodUnlockLog` row in the same transaction.
5. **Opening balances** are `OPENING` entries; the plug goes to 3200 Saldo Laba. Prior-year P&L folds into 3200 in the TB.
   Saldo Awal prefills bank lines from the first statement and proposes (never posts) time deposits the statements list
   (`StatementImport.deposits`, on 1260, changeable); loan rows in the statements prompt for the loan balance.
5a. **Adjustment schedules** (`lib/adjust`): depreciation, amortisation and accruals are an `AdjustmentSchedule` (entity, debit / credit
    account, total in minor units, months, start). Installments are exact (⌊total/n⌋, remainder on the last); an accrual is one month
    and reverses on the 1st of the next. Each month's installment is **proposed at read time and posted only by the accountant's click**
    through `postJournal()` (kind `ADJUSTMENT`), carrying `scheduleId` + `installment` (unique: posts once). Never edited after posting —
    stop and create a new one (a stop is checked under a row lock when posting; installments due through the month of the stop stay owed and proposed until posted, later ones are dropped; a stopped accrual still reverses what it posted). An installment stays proposed from its month until posted, in every later month too, unless its month is locked; a schedule with any installment (or reversal) in an already locked month is refused at creation (under a per-client close lock that closing a month also takes; a close refuses if a schedule due by that month, overdue ones included, appeared while its controls ran). Candidates (fixed-asset purchase, prepayment, deferred revenue, recurring cost missing this month) are
    deterministic suggestions only; a schedule made from an entry stores that line (`sourceEntryId` + `sourceAccountId`, which it must release: an asset by depreciation — an expense debited, accumulated depreciation or that asset credited — a prepayment or deferred revenue by amortisation, the prepayment on credit, the deferred revenue on debit) and covers only it; schedules made before the line was stored are matched one to one by memo, then amount. A due, unposted installment is a REVIEW control `sched:`.

## Money
5b. **Fixed-asset register** (`lib/assets`): a `FixedAsset` per entity (fiscal group, fiscal method, acquisition date, cost, residual,
    book life, asset account, accumulated-depreciation account — none for land). Its book depreciation **is** its `AdjustmentSchedule`
    (rule 5a, straight line of cost − residual − opening accumulated), created with the asset in one transaction, or an existing
    depreciation schedule linked when it depreciates exactly that amount and starts no earlier than a new one could (not before the
    acquisition month; with opening accumulated depreciation, after the opening month). Accumulated depreciation and book value are **read from the GL**
    (opening accumulated + the schedule's posted installments at the date asked), never stored. One asset per purchase line
    (`sourceEntryId` + asset account, rule 15). **Fiscal depreciation** (`lib/assets/fiscal.ts`, UU PPh Pasal 11 / PMK 72/2023) is an
    estimate for the tax computation, never posted: from the acquisition month; a yearly amount = the group's rate on the cost (straight
    line) or on the fiscal book value at the start of the year (declining balance), pro rata by months, half-up; the year the life ends
    takes the rest; buildings straight line only, land none. **Disposal** = one `ADJUSTMENT` entry by the accountant's click: Dr
    accumulated to date, Dr proceeds (a non-bank account; the bank receipt is classified to it), Cr the asset at cost, the difference on
    **7300 Laba/Rugi Pelepasan Aset Tetap** (used only when named so; created on the first disposal if the code is free, else the
    accountant picks). Refused while an installment through the disposal month is unposted; the schedule stops; the asset keeps
    `disposalEntryId`. The close control `fa:<entity>` compares the register's cost and accumulated depreciation with the GL accounts it
    uses: equal = PASS, else REVIEW (never FAIL: unregistered assets and typed journals explain a difference).
5c. **Receivable/payable subledger** (`lib/receivables`, ADR 0004 amendment): an `Invoice` per entity (SALES = piutang, PURCHASE =
    utang; contact, number unique per entity + direction, issue ≤ due date, DPP + PPN = total > 0, counter account, receivable/payable
    account PIUTANG_USAHA / UTANG_USAHA). Saving posts it through `postJournal()` (kind **INVOICE**): sales Dr receivable / Cr revenue +
    2130; purchases Dr expense or asset + 1150 / Cr payable; a **Saldo Awal** invoice posts nothing and is dated by the opening (open items, aging, CKPN and
    `ar:`/`ap:` include it only from the opening date; it ages from its own due date). PPN is
    the tax invoice's amount (prefill = effective 11 %, rule 8). An `InvoiceSettlement` links a **bank line** to an invoice for an
    amount — a subledger link only, never a journal: the line must be the entity's, in the invoice's direction, **posted to the invoice's
    receivable/payable account**, in an open month; Σ per invoice ≤ total and Σ per line ≤ its amount under row locks. A line elsewhere
    is first classified through the reviewer's writer (`reviewTransactionTx`, rule 3) in the same transaction. Suggestions (equal open
    amount, contact name or number in the description) are never applied on their own. Open amount at a date = total − settlements by
    bank lines dated by then; aging by days past due (0 / 1–30 / 31–60 / 61–90 / > 90). Close controls `ar:` / `ap:` compare Σ open
    invoices with the GL balance of the accounts they use: equal = PASS, else REVIEW with the count of unmatched bank lines.
5d. **Tax pack — PPh badan** (`lib/tax`): per company (not PERORANGAN) with IDR books and calendar fiscal year, **computed at read time**
    through the chosen month; only the accountant's records are stored (`TaxYear` regime, `FiscalCorrection`, `TaxCredit`, dismissed
    suggestions, `TaxPosting`). Laba sebelum pajak (BEBAN_PAJAK excluded) + koreksi fiskal → PKP rounded down to thousands (a loss = 0; no
    carry-forward). Automatic corrections: book − fiscal depreciation of the asset register (beda waktu); *pendapatan lain* named bunga / jasa
    giro / deposito out as final-taxed income (beda tetap). Correction **categories** by account-name words (`lib/tax/categories.ts`:
    entertainment, donations, penalties, natura, PPh expensed, 50 % phones and service vehicles, provisions, employee benefits) are
    **suggestions only**; an accepted one follows its account's year-to-date balance × its % (1–100, changeable). **Kompensasi kerugian**:
    losses typed per origin year as left at 1 January (at most five years back), used oldest first up to fiscal profit, expired ones
    skipped; last year's December fiscal loss from the books is only suggested. The **Excel kertas kerja** is built from the same pack. Normal regime 22 %, Pasal 31E (turnover = usaha revenue ≤ Rp 50 M: PKP × 4,8 M ÷ turnover at
    11 %), each part rounded down; PP 55/2022 final 0,5 % of turnover when the accountant chooses it (no corrections, credits or journal).
    Credits = PPh 25 bank lines (tag PPH_25, wherever they sit; by **masa pajak** `BankTransaction.taxMonth` — the month before payment when the line is classified, editable in the pack; a line without one counts by its bank date) + bukti potong typed with the account they sit on → PPh 29 (2146) or 28A (1181);
    next year's PPh 25 = (terutang − PPh 22/23/24) ÷ 12. Deferred tax = 22 % × (fiscal − book value of the register + the CKPN allowance, 5e). **Journals by click only**
    (`ADJUSTMENT`, dated the period end): each books the **difference** from earlier postings of its kind (deferred balances across years) under a
    per entity-year lock; pack accounts (1181, 1270, 2146, 2320, 8110) are created on first use when free, a code used for something else is
    refused. December control `tax:` is REVIEW while the current-tax journal has a difference. The firm rule files "PPH 25" to 1180 (prepaid).
    Everything is labelled an estimate, never an SPT.
5h. **Withholding — PPh 21/22/23/4(2)** (`lib/tax/withholding.ts`): tax a payer withholds is the part of a payment *not in the bank amount*, so it lives on the
    **classification side** of the bank line's journal (`BankTransaction.whtKind` + `whtAmount`, posted and changed by `postBankTransaction`'s RECLASS of the difference — the bank side
    never moves, rule 3). Receipts (a customer withholds): Dr 1180 for PPh 22/23, Dr 8200 for PPh 4(2) (final, not a credit) and the receivable is credited **gross**; payments (we
    withhold): the payable / expense / lease liability is debited gross, Cr 2140 PPh 21, 2141 PPh 23, 2145 PPh 4(2)/22, until the remittance (rule 13a) clears it. The tax account is a
    template account created on first use when the code is free. An `Invoice` may name the expected tax (`whtKind`, `whtAmount` on the DPP); it stays gross and posts as before. An
    `InvoiceSettlement.amount` is what it clears on the invoice (gross); `withheld` is the tax part of it, so open amount, aging, CKPN and `ar:`/`ap:` still read Σ amount. A settlement that
    closes the invoice with a shortfall within the expected tax books that tax by default (else it is typed); a bank line's free amount = |amount| − Σ (amount − withheld). Tax on a
    settled line changes only by (un)settling. It is never added to the tax pack's credits on its own (the accountant types the bukti potong).
5e. **CKPN piutang — PSAK 109 simplified approach** (`lib/receivables/ckpn.ts`): per entity with a saved `CkpnSetting`, computed at read
    time from its **sales invoices and settlements** (no stored aging). Loss rates are **Roll rate** (invoice by invoice between consecutive
    month-ends over the last N months: of what was open in a bucket and has aged beyond it by the next month-end, the share still open, capped
    at 100 %, averaged over months with such an amount; loss rate = next bucket's loss rate × roll, the > 90 hari rate is set) or **Manual**
    per bucket. Allowance per bucket = open × loss rate × forward-looking factor (0–300 %), half up. A bucket with an open amount and no rate
    blocks the proposal (never guessed). Rates are integers (bp settings, ppm computed); amounts stay bigint. **Journal by click only**
    (`ADJUSTMENT`, period end): 1135 (contra receivable, credit) to the allowance against 6185, the difference from 1135's GL balance, under
    the close lock and a per-entity lock; refused when 1135 already moved after the period end. 1135 is never an invoice's receivable
    account. Control `ckpn:` is REVIEW while there is a difference. Write-offs (hapus buku) are manual journals.
5f. **Lease register — PSAK 116 lessee** (`lib/leases`): the contract is stored (`Lease`: start month, term > 12 months, payment,
    interval 1/3/6/12 months dividing the term, advance or arrears, annual discount rate in bp); the **schedule is computed**: liability =
    exact present value at annual ÷ 12 (rational bigint, rounded once), interest half up per month, the residue in the last payment's month
    so the liability ends at 0; ROU = the initial liability, straight line; current portion = liability − liability 12 months later.
    Journals by click only (`ADJUSTMENT`): the commencement on registration (Dr 1230 / Cr 2170 current + 2400 non-current, dated the start
    month's 1st), one entry per lease-month (`LeasePosting`, unique) — Dr 6181 / Cr 1239, Dr 7195 / Cr 2170, the non-current decrease
    2400 → 2170 — posted all-or-nothing up to the chosen month; a mistake is cancelled by reversing the commencement (never deleted), only
    before any monthly journal. Payments are bank lines classified to 2170. Control `lease:` REVIEW while a month is unposted or 1230 /
    1239 / 2170 + 2400 differ from the register. Tax: correction (depreciation + interest − rent straight line over the term) and deferred
    tax on (payments − fiscal rent) − (ROU net − liability). Lease entries are never asset or schedule candidates. Template accounts added
    later are created on first use only when the code is free or holds the same side and name; imported new accounts never take a template code.
5g. **Employee benefits — PSAK 24, PP 35/2021** (`lib/benefits`): the census (`Employee`), the firm's uploaded mortality table (qx × 10⁹;
    **Buku ships no table it can't verify**) and the entity's assumptions are stored; the valuation is computed. PUC year by year to the
    retirement age: death / disability (2 × pesangon + UPMK), retirement (1,75 × pesangon + UPMK), resignation nothing; attribution over the
    last 24 years before payment or from hire (DSAK IAI 2022). Probabilities and rates are float; each obligation is wage × factor (10⁻⁹,
    half up), bigint. Journal by click only (`ADJUSTMENT`, `BenefitPosting`): 2310 to the DBO; 6105 year to date = (service + interest cost
    of the previous 31 December valuation) × months ÷ 12 + the obligation of employees hired since; in the entity's first Buku year the
    opening obligation not in 2310 → 3200; the rest → 3920 (equity, OCI). All against GL balances, so paid benefits and re-posting are
    respected. Control `eb:` in December. Tax: 2310 is a deductible temporary difference; the deferred tax on the remeasurement goes to 3920.
    Everything is labelled an estimate, not a licensed actuary's report.
6. `bigint` **minor units of the entity's functional currency** everywhere in the domain (ADR 0006). IDR has exponent 0,
   so for IDR entities that is whole Rupiah, as before. Parse with `parseRupiah()` / `parseMinor()` (handles `1.234.567,00`,
   `1,234,567.00`, `(2.500)`), format with `formatRupiah()` / `formatMoney(value, currency)`. Convert to `Number` only for chart
   pixels. Across the server→client boundary pass bigint as string. Never add amounts of entities with different currencies
   without translating first (rule 11).
6a. **IDR sen:** source amounts with sen round half-up per line to whole Rupiah; the entry's residue goes to one line on
   **7190 Selisih Pembulatan** (`roundEntry()`). Never spread it silently over other lines. Same for conversion: when a ledger
   group balances in every source currency, the ≤ 1 minor unit per converted line left after converting goes to 7190
   ("Selisih pembulatan konversi kurs"); a larger residue, or a group that doesn't balance per currency, is a real difference.
6b. **Foreign-currency lines** keep `currency`, `fxAmount` (minor units) and `fxRate` (decimal string, functional per 1 unit);
   `postJournal` checks `round(fxAmount × fxRate) = functional amount` (±1 minor unit). Rates are `ExchangeRate` rows (typed in
   or taken from the file) — never fetched live. A file rate only **fills an empty date** (insert-only, so two imports racing keep the first); it never overwrites a Kurs row (the table
   is per firm), and a differing one is shown as REVIEW `FX_FILE_RATE_DIFFERS` on the draft. Month-end revaluation is **proposed** to **7200 Laba/Rugi Selisih Kurs** and
   posted only by an explicit click.
7. Dates are date-only `@db.Date` (UTC midnight). Read with `getUTC*`. Use `dateOnly()` / `periodBounds()`.
8. PPN split: tagged lines split gross → DPP + PPN at `PPN_EFFECTIVE_PERCENT` (11% = 12% × 11/12). `dpp + ppn === gross` always. It's an estimate — label it.

## Chart of accounts (per client, shared by its entities so combined reports line up)
9. Special codes are load-bearing — never renumber: **7300** disposal gain/loss, **1190** intercompany, **1199** transfer clearing,
   **1999** suspense (Belum Terklasifikasi), **3200** retained earnings, bank GL accounts **1101–1109**,
   overdraft (PRK) bank accounts **2201–2209**, **7190** rounding, **7200** FX gain/loss, **3900** translation difference.
9a. An entity's own codes live in `SourceAccount` (per entity), each mapped to exactly one client account. Imported lines keep
   `sourceAccountId`; the *Akun sumber* TB groups by it, and a client account's ledger (and its *Akun sumber* TB row) reads by the accounts its lines were posted to
   (a remap moves no posted line, so it never reinterprets history); its opening follows each line's own account, like the TBs
   (income & expense from 1 January, balance sheet from the start). Mapping suggestions (rules → AI on **names only**) are applied only by the
   accountant's explicit click; an import can't post while any source account is unmapped. A rule that only knows the
   side of the books ("expense", "payable") proposes a **new client account** named after the file's account
   (`suggestedCode = new:<FS_LINE>`) instead of a catch-all; the account exists only after that click. Types come from
   strong name words, then the file's own code scheme, then weak words (`inferType`).
10. Same-entity transfer → 1199 (must net to 0). Cross-entity → 1190, posted in *each* entity's books,
    eliminated in the combined worksheet (receivable vs payable, matched = min). Residual ≠ 0 → REVIEW.
11. PT + owner individual combined is a **management "Gabungan"**, not SAK consolidation. Keep the label + tooltip.
    Gabungan / Beranda are in IDR: non-IDR entities are translated — assets & liabilities at the closing rate, income & expense at
    the period's average rate, equity at the historical rate; the residue is the equity line **3900 Selisih penjabaran**. A missing
    rate shows the entity as *belum dijabarkan* — never a number computed with a guessed rate.

## Import & classification (`lib/import/pipeline.ts`)
12. Parse → continuity check (opening + Σ = every printed balance → closing) → dedupe by row hash → classify → post, all-or-nothing in one transaction.
13. Order: **transfer matcher → rules (client before firm) → memory → financing suggestion → AI → heuristic.** Transfer matching
    needs a textual hint (TRSF/PINDAH BUKU/own entity name) — equal amounts alone are never enough — and pairs within **2 business
    days** (Sat/Sun don't count). Financing text (the sanity control's words, `lib/classify/financing`) gets a balance-sheet
    suggestion (loan → 2210, interest → 7110, fees → 7100, capital → 3100, own-account move → 1199) without an AI call; it is a
    HEURISTIC and goes to review. Bank interest, fees and stamp duty as banks print them (BUNGA/INTEREST out → 7110, TAX ON
    INTEREST → 8200, BIAYA TXN / FEE PAYMENT / MATERAI / STAMP DUTY → 7100) are firm **rules** (they post); a new firm rule reaches
    existing firms only through a data migration. The last-resort simple guess depends on the entity (`lib/classify/fallback.ts`):
    company in → 4100 / out → 6190; PERORANGAN in → 4910 / out → 3300 Prive.
13a. **Tax remittances file to the liability they clear** (firm rules, `lib/classify/rules.ts`): PPh 21 → 2140, PPh 23 → 2141, PPh 4(2) / final → 2145, PPh 29 → 2146, PPN → 2130, PPh 25 → 1180
    (prepaid, rule 5d), Bea Meterai → 7100. A remittance without the withholding booked leaves that liability **debit**, which the sanity control *Saldo berlawanan dengan sifat akun* raises
    — book the withholding (payroll, or rule 5h) rather than moving the remittance. A rule whose account the client's chart lacks is skipped (`matchRule(…, codes)`), never a failed import.
14. **Only deterministic methods (TRANSFER/RULE/MEMORY, confidence ≥ 0.9) auto-post.** AI and heuristic results
    post to **1999** with `NEEDS_REVIEW` and a prefilled suggestion. Reviewer accept → reclass + Memory upsert.
    A merchant key that names no counterparty (only channel/transfer/loan/cash words, refs and digits — `isGenericKey`,
    `lib/import/normalize.ts`: "BI FAST OUTGOING", "PINJAMAN LOAN", a bare "TRSF E-BANKING DB <ref>") covers unrelated payments:
    it is never written to or read from Memory, never made a rule, never grouped as *serupa*. An accepted line can be moved later
    from its ledger drawer (*Ubah akun*) through the same reviewer's writer.
15. Every bank-derived entry carries `bankTransactionId`; `BankTransaction` keeps `rawRow`, `rowNumber`, `importId`.
    Every ledger-derived entry carries `ledgerImportId` + `sourceRef` (`sheet!row` range) and its lines keep their row refs.
    That chain is the product's trust story — don't break it.
15a. **Ledger / Neraca import** (`lib/ledger-import`): read → check → map → post, all-or-nothing in one transaction, via
    `postJournal()` (kind `IMPORTED`, or `OPENING` for Neraca). Checks are deterministic and cite rows: BLOCK (non-numeric cell,
    missing date/account, unbalanced group, unknown currency, missing rate) stops posting; an unbalanced group may be **explicitly
    accepted**, which posts its difference to 1999 with memo "Selisih dari file sumber". Same file twice for the same entity is refused.
    Each such 1999 line gets a deterministic correction proposal (`lib/adjust/suspense.ts`, rule 20b): reverse it on 1999 against a
    counter account — prefilled only when one line of the same entry has exactly that amount — posted only by the accountant's click
    (it can't be dismissed: the close FAILs until 1999 is cleared), keeping the group's `ledgerImportId` + `sourceRef`. It is offered
    and posted only while the entity's 1999 balance (bank lines waiting in Review left out) still holds that difference — never
    reversed twice, e.g. after a manual fix; when no single line fits what is left (offsetting differences, a partial fix), the entity
    gets one correction for the remaining balance, so the FAIL always has a way out.
16. Parsers detect format from **content**, not file name, and raise `ParseError` with a Bahasa message the UI shows verbatim.

## AI (credit is limited — treat every call as money)
17. LLM runs **outside** DB transactions, only for leftovers, **one request per unique merchant key + direction**,
    batched (≤40/call), cached in `AiSuggestion` with firm/client isolation (key implementation: `lib/ai/classify.ts`).
    Account mapping (rule 9a) follows the same discipline: names + type hints only (no amounts, no descriptions), ≤40 per call,
    cached by `(normalised name, type hint, coaVersion)`, whitelisted against the client chart, counted in the same caps.
    Timeouts: 90 s per classification/mapping call, 180 s for close review and *Jelaskan* (`AI_TIMEOUT_MS`, `AI_LONG_TIMEOUT_MS`).
    A failed call leaves the simple guess; Review offers *Minta saran AI* for those lines (`lib/ai/retry.ts`: the same cache, batches,
    caps and budget; financing text excluded; it only replaces the suggestion of lines still in review — nothing posts).
18. All paid paths reserve the shared monthly allowance atomically through `lib/ai/budget.ts` before network calls. Evidence context proposals and read-only query plans use bounded source passages, versioned citations, and scope/model/prompt caches; monetary answers are deterministic tool results (ADR 0007). Existing classification/mapping payload restrictions still apply. Hard caps: `AI_MAX_CALLS_PER_IMPORT`, `AI_MONTHLY_TOKEN_BUDGET`; every call logged in `AiUsage`. No retry loops.
19. Bank text is untrusted: output codes must be in the client's COA whitelist (`parseAiResponse`), else dropped.
20. Tests and the seed **never** call a real model (`MockProvider`, pre-cached answers). `npm run ai:smoke` is the only live call.
20a. **AI close review** (ADR 0009) may send amounts and ≤ 80-char bank descriptions of the rows behind flagged controls only
    (≤ 40 rows). It explains and proposes; it never posts, acks, ticks or locks. Items citing keys/ids it wasn't given are dropped.
20b. **Close copilot / proposed entries** (`lib/controls/explain.ts`, `lib/adjust/proposals.ts`): *Jelaskan* sends one flagged control's
    rows (20a caps) and gets an explanation, an optional note (a prefill the accountant saves) and an optional draft journal —
    kept only if every account is in the chart (never a bank account), it balances, and **every amount equals the amount of a row the answer cites** (checked again when it posts).
    Drafts are `ProposedEntry` rows, posted only by the accountant's click (accounts editable, amounts never) through `postJournal()`;
    a draft that moves one cited **bank line** posts through the reviewer's writer instead (RECLASS + Memory, rule 3); one that moves
    cited bank lines any other way (several lines at once) gets no draft, never a free journal. A cited journal line or entry
    (`jl:`/`je:`, as the ledger anomaly scans cite) counts as its bank line when it came from one, and every account that line posts
    to (classification, tax split, suspense) is part of it. Group-level
    controls get words only. Deterministic proposals (e.g. 1999 corrections) use the same table.
    A draft that moves a bank line is not created, shown as blocked and refused on post when an `ADJUSTMENT` of that entity, dated from
    the line's date to the period end, already moves exactly its amount off its account (`priorCorrection`): never correct twice.
    Drafts for a PT or foreign company never see the Prive line (3300); a CV's or an individual's may.
21. Provider is OpenAI-compatible `fetch` (OpenCode Zen default) behind `AiProvider`; swap by config, not code.
    Key + model: **Pengaturan (DB, encrypted) overrides env** — resolve via `resolveAiConfig()` (`lib/settings/ai.ts`).
    `AI_BASE_URL` stays **env-only** so a visitor can't redirect the stored key. *Cek koneksi* hits `GET /models` (no tokens).

## Close
22. Controls (`lib/controls`): TB balanced, A = L + E, bank statement balance = GL per account, continuity,
    1199 = 0, 1999 empty, 1190 eliminated, ledger-import checks (accepted BLOCK = FAIL, REVIEW = REVIEW),
    FX revaluation posted when a foreign-currency balance exists. **REVIEW ≠ bug** — it needs a human note. **FAIL blocks** Tutup Buku.
    A bank account needs a statement only from the month its books start: a month ending on or before the entity's OPENING entry
    (without one, before the account's first statement) passes with "Pembukuan rekening ini mulai …". Gaps after the start still flag.
22a. **Sanity controls** (`lib/controls/sanity.ts`, ADR 0009) check that the books make sense, not only that they add up:
    negative total assets = **FAIL**; balance-sheet balances against their `normalBalance`, financing text (loan, PRK, deposit,
    own-account transfer) classified to the P&L, a month without data between active months, accepted guesses
    (HEURISTIC, or AI < 0.6 unchanged), a company whose liabilities exceed its assets (*Defisiensi modal*, `going-concern:`; CALK
    then adds a *Kelangsungan usaha* note), and revenue in the month with no HPP when the client's *Bidang usaha* reads as trading
    (`no-cogs:`) = REVIEW. Deterministic only — AI never decides a control.
22b. **Ledger anomaly scans** (`lib/controls/anomaly.ts`, ADR 0009 amendment) read journal lines, not bank rows, so ledger-fed
    clients get the same scrutiny. Movement excludes OPENING entries; baseline = the months with activity among the 3 before the
    period; materiality = 1 % of the baseline's average monthly P&L volume (all movement when the baseline has no P&L, e.g. a holding). **Flux** (P&L account differs from its baseline average by
    ≥ materiality and ≥ 50 %; the account itself moved in ≥ 2 baseline months), **flip** (P&L month movement against its `normalBalance`), **dormant** (movement on an
    account with none in 3 active prior months: *akun baru* or *bergerak lagi*), **dup** (identical entries ≤ 3 days apart; two
    bank-derived entries never pair, two rows of one ledger file only with the same memo, OPENING/RECLASS never). All REVIEW, never FAIL;
    7190/7200 exempt from flux/flip. The AI close review may send the flagged accounts' month series and the month's journal lines behind
    them (memo ≤ 80 chars) under rule 20a's caps.
23. Tutup Buku requires: no FAIL, every REVIEW acknowledged with a note, all sign-offs ticked.

## Tenancy
24. Every row has `firmId`. Server actions resolve the client through `getClientForFirm()` before any write.
25. **Deleting a client** (`lib/clients/delete.ts`) is not a ledger correction: an admin removes a client entered by mistake or a test
    copy after typing its exact name. Everything that is its books (entities, accounts, periods, journals, bank and ledger imports,
    memories, client rules, proposals, invoices, assets, schedules, leases, employee benefits, tax records, evidence) goes in one
    transaction; firm rules, rates, mortality tables and
    AI caches stay. A new table that references a client or entity must be added to that function.

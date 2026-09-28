# Piutang & Utang — faktur, pelunasan dari rekening koran, umur piutang/utang

## Context
Feedback 2026-09-28 (Syaukani): "ga ada modul AR dan AP". The competitor he showed (automa8e) turns documents into invoices and
journals. Buku today sees receivables and payables only as GL balances (1130 Piutang Usaha, 2110 Utang Usaha): nobody can say *who*
owes what, which invoice a bank receipt paid, or how old the open items are — and the close can't prove that 1130/2110 are made of real
invoices. For an accounting firm those are standard month-end questions (daftar piutang, umur piutang, konfirmasi saldo).

[ADR 0004](../adrs/0004-wedge-and-scope.md) kept "AR/AP invoicing" out of the first version. This cycle adds the **subledger**, not an
invoicing product: the accountant records the client's invoices and bills (typed, or from Saldo Awal), the bank statement settles them,
and the subledger is proven against the GL at close. No sending invoices, no e-Faktur, no AI.

## Spec
Records (`lib/receivables/`, new; models `Contact`, `Invoice`, `InvoiceSettlement`)
- [ ] **Contact** per client (pelanggan / pemasok by use): name (unique per client), optional NPWP.
- [ ] **Invoice** per entity: direction **SALES** (piutang) or **PURCHASE** (utang), contact, number (unique per entity + direction),
      issue date, due date (≥ issue date), description, DPP, PPN (optional; prefilled at the effective 11 %, editable), total = DPP + PPN,
      counter account (revenue for sales; expense or asset for purchases), receivable/payable account (default 1130 / 2110; must be
      PIUTANG_USAHA / UTANG_USAHA). Amounts in the entity's functional currency (minor units).
- [ ] **Saving an invoice posts its journal** through `postJournal()` (new entry kind **INVOICE**, label *Faktur*): sales Dr 1130 total /
      Cr revenue DPP / Cr 2130 PPN Keluaran; purchase Dr expense DPP / Dr 1150 PPN Masukan / Cr 2110 total. The invoice keeps its
      `entryId` (drill both ways). Locked periods refuse it. **Saldo Awal invoices** (open items at the opening date) post nothing — the
      opening entry already holds the balance.
- [ ] **Settlement** links a bank line to an invoice for an amount (partial payments, one receipt for several invoices, several receipts
      for one invoice). Only bank lines of the same entity in the right direction (sales ← money in, purchase → money out) **posted to the
      invoice's receivable/payable account**; Σ settled ≤ invoice total and ≤ the bank line's amount, checked under row locks. A settlement
      is a subledger link only — the bank line already moved the GL (rule 3 unchanged). A line in review or on another account can be
      settled in one click that first **reclassifies it through the reviewer's writer** (`reviewTransactionTx`: RECLASS + Memory, same
      transaction). Removing a settlement is allowed while its month is open.
- [ ] **Match suggestions** (deterministic, never applied on their own): for each open invoice, bank lines of the entity in the right
      direction, not fully settled, dated from the issue date, whose unsettled amount equals the invoice's open amount; ranked first when
      the description contains the contact's name or the invoice number.
- [ ] **Open amount and aging at a date** (period end): total − settlements dated by then, for invoices issued by then; aging by days past
      due: *Belum jatuh tempo*, 1–30, 31–60, 61–90, > 90; per contact and per invoice.
- [ ] **Close controls** `ar:<entity>` / `ap:<entity>` (only when the entity has invoices of that direction): Σ open invoices vs the GL
      balance of the receivable/payable accounts they use, at the period end. Equal = PASS; different = **REVIEW** with both figures and the
      count of bank lines on those accounts not settled yet (the usual cause).
- [ ] **UI:** *Piutang & Utang* page under Akuntansi (ScopeBar period + entity; tabs *Piutang* / *Utang*): NextStep, aging per contact with
      totals and the GL comparison, open and settled invoices, *Faktur baru* (contact typed or picked), *Faktur saldo awal*, per invoice
      *Cocokkan pembayaran* (suggestions first, any eligible line after), *Penerimaan / pembayaran belum dicocokkan*. Invoice journals show
      "Faktur <number>" in Buku Besar. Works at 390 px.

**Gate-reopeners (flagged):** schema migration (Contact, Invoice, InvoiceSettlement, enums `InvoiceDirection`, `EntryKind += INVOICE`,
CHECKs: amounts ≥ 0, total = DPP + PPN > 0, due ≥ issue, settlement amount > 0); a new accounting rule **5c**; this cycle revises the
ADR 0004 non-goal (subledger yes, invoicing product no) — recorded as an ADR amendment. No dependency, no AI.

**Non-goals:** sending or printing invoices, e-Faktur/Coretax, credit notes and invoice cancellation (a correction is a reversing Jurnal
Penyesuaian), multi-line invoices (one counter account per invoice), foreign-currency invoices, withholding (PPh 23) on settlement,
settlement by non-bank entries (netting), documents → invoice drafts (a later AI cycle over the evidence workspace), payment reminders.

**Assumptions:**
1. The accountant records invoices after the fact from the client's documents; the invoice date drives the journal date (accrual basis).
2. PPN on the invoice is the tax invoice's amount; the prefill is DPP × 11 % rounded half-up (the effective rate, rule 8).
3. A receipt for an invoice is classified to 1130 (or the invoice's account) — the settle-with-reclass click does it when it isn't.
4. Saldo Awal invoices must fit into the opening 1130/2110 balance; the close control shows it when they don't.
5. Aging uses the due date; invoices without a separate due date use the issue date (due immediately).

## Tasks
- [x] T1 Schema: migration `receivables` (Contact, Invoice, InvoiceSettlement, enums, EntryKind INVOICE, CHECKs), ledger kind label, ADR 0004
      amendment — accept: `prisma migrate diff` empty; gate green.
- [x] T2 Invoices: `lib/receivables/invoices.ts` — `createInvoice` (posts the journal; Saldo Awal without), contacts upserted by name —
      accept: DB tests (sales with PPN, purchase to an asset account, Saldo Awal, duplicate number, due before issue, locked month,
      wrong account types). Depends T1.
- [x] T3 Settlements: `lib/receivables/settle.ts` — `settle` (locks, limits, direction, account), `settleWithReclass`, `unsettle`,
      `matchSuggestions` — accept: DB tests (partial, one receipt for two invoices, over-settlement refused, wrong direction, reclass
      from 1999 in one transaction, locked month, suggestions ranked by name). Depends T2.
- [x] T4 Aging + control: `lib/receivables/aging.ts` (`openItems`, `aging`, `subledgerVsLedger`), `ar:`/`ap:` in `runControls` —
      accept: DB tests (buckets at a date, settlements after the date ignored, PASS/REVIEW with the unsettled count). Depends T3.
- [x] T5 UI: page, components, actions, sidebar — accept: e2e walk (sales invoice → bank receipt reviewed → cocokkan → aging and control;
      purchase invoice partly paid), screenshots at 1440 and 390 px. Depends T4.
- [ ] T6 Rules + docs: `accounting-rules` 5c, README, ADR amendment — accept: end-of-cycle gates (build, `verify:books` ALL PASS, full e2e).

## Implementation
- Plan: T1–T6 sequential, inline (one driver keeps the invariants straight; each layer uses the previous).
- T1: `prisma/schema.prisma`, migration `20260929010000_receivables` (Contact, Invoice, InvoiceSettlement, `InvoiceDirection`, `EntryKind` + INVOICE, CHECKs), `components/app/ledger-table.tsx` (*Faktur* label), ADR 0004 amendment.- T2: `lib/receivables/invoices.ts` (`createInvoice`, `ppnFor`; contact upserted by normalised name; Saldo Awal items must be dated by the entity's opening entry), `tests/db/invoices.test.ts`.
- T3: `lib/receivables/settle.ts` (`settle`, `settleWithReclass` via `reviewTransactionTx` in one transaction, `unsettle`, `settleCandidates` — named = every distinctive word of the contact (PT/CV dropped) or the invoice number; exact = unsettled amount equals the open amount), `tests/db/settlements.test.ts` (bank lines imported through the real pipeline).
- T4: `lib/receivables/aging.ts` (`invoicesAt`, `agingByContact`, `bucketOf`, `subledgerVsLedger`), `lib/controls/index.ts` (`ar:`/`ap:` per entity with invoices of that direction), `tests/db/aging.test.ts`.
- T5: `app/(app)/clients/[id]/receivables/page.tsx` (tab in the URL), `components/app/receivables.tsx` (aging per entity with the ledger row, unmatched bank lines, open and paid invoices with their settlements behind a visible chevron, invoice form with *Hitung 11%*, matching dialog with editable amounts), `lib/receivables/view.ts`, `app/actions.ts` (`createInvoiceAction`, `settleCandidatesAction`, `settleAction`, `unsettleAction`, tenant-checked), sidebar *Piutang & Utang*, `e2e/receivables.spec.ts`. Found on the 390 px screenshot: keeping only the *Belum jatuh tempo* bucket on phones showed "–" while the amount sat in a hidden bucket — phones now show party and total only.

## Verification
- T1: `prisma migrate diff` DB ↔ schema empty. Gate: lint ✓ typecheck ✓ `Test Files 68 passed (68) · Tests 513 passed (513)`.- T2 gate: lint ✓ typecheck ✓ `Test Files 69 passed (69) · Tests 518 passed (518)`.
- T3 gate: lint ✓ typecheck ✓ `Test Files 70 passed (70) · Tests 521 passed (521)`.
- T4 gate: lint ✓ typecheck ✓ `Test Files 71 passed (71) · Tests 523 passed (523)`.
- T5: `npx playwright test e2e/receivables.spec.ts` → `1 passed` (statement imported → INV-100 with PPN 1.100.000 → the receipt naming it suggested first, classified to 1130 and settled in one click → paid, piutang = ledger → SM-77 paid 10 jt of 22,2 jt → 12.200.000 in 1–30 hari = 2110). Screenshots at 1440 and 390 px checked by eye.

## Ship Notes

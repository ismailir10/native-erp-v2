# Receipts against notes: FIFO, overpayment as advance, voiding a wrong document, sales by channel

## Context
Use-case feedback UC-B5 ("Penjualan, nota, dan piutang tanpa subledger"), from Belifi: revenue = cash in + unpaid notes.
- The register holds 215 notes (Rp 22,99 juta) against Rp 51,3 juta of credits to the PT, so payments exceed the notes and everything
  looks paid (FIFO).
- 36 supplier documents were entered as notes and must come out.
- Sales sit on one account (4101) with no channel: marketplace about 5,6 %, reseller transfers 94,4 %.

Pass conditions:
- one receipt to many notes and back, with an overpayment shown as an advance (uang muka), not lost;
- wrongly entered documents removed with a reason;
- aging and the Piutang Usaha balance equal the ledger;
- sales cut by channel and by customer.

Traps:
- an overpayment must not make the receivable negative without a flag (today "saldo piutang negatif lolos di Review", #5);
- undated or low-confidence notes go to a queue, never assumed.

Buku already settles one receipt against several invoices (`lib/receivables/settle.ts`, rule 5c), one invoice at a time. Missing:
- FIFO;
- a home for the part of a receipt beyond the open notes;
- removing a wrong document;
- a channel on the customer.

Also, the subledger check today calls the books unequal whenever a receipt isn't fully matched: unmatched cash is the usual cause, but
it isn't a difference.

## Spec
- [ ] **Cocokkan FIFO.**
  - On an unmatched receipt (or payment), pick the customer (supplier). Buku settles that contact's open invoices in this entity, oldest
    due first (then issue date and number), until the line's free amount or the invoices run out.
  - Each allocation is an ordinary settlement (rule 5c): row locks, open month, the same refusals.
  - A line still in Review or on another account is classified to the invoices' receivable/payable account first, through the
    reviewer's writer, as *Klasifikasikan lalu cocokkan* does today.
  - Invoices expecting withholding are settled for cash only; the tax stays expected, as for a manual settlement without tax.
  - The result names the invoices settled and the remainder.
- [ ] **The rest is the contact's advance (uang muka).**
  - A FIFO (or manual) match tags the bank line with its contact (`BankTransaction.contactId`).
  - Whatever is left unmatched on a tagged line is that contact's advance: shown in the aging as a credit column *Uang muka / kelebihan
    bayar*, and offered first when the contact's next invoice is matched.
  - The subledger proof becomes Σ open invoices − Σ unmatched receipts on the account = GL. Equality no longer depends on every receipt
    being matched; untagged unmatched cash shows as *Belum dialokasikan*.
  - A contact whose advance exceeds their open invoices (a net credit) is shown in review colour.
  - A close control "Kelebihan bayar pelanggan / pemasok" (REVIEW) lists those contacts and amounts, with the advice to reclassify by
    journal if it won't be invoiced.
- [ ] **Keluarkan dokumen.**
  - A wrongly entered invoice or bill (e.g. a supplier document entered as a sales note) can be voided with a reason (min. 10
    characters).
  - Its journal is reversed by a mirror entry dated on the original's date. That date must be in an open month; otherwise the void is
    refused, naming the month.
  - A Saldo Awal item posts nothing and is only marked.
  - A voided document leaves open items, aging, CKPN and the subledger proof. It stays listed (struck through, with the reason) and in
    the history.
  - Refused while it has settlements ("hapus pencocokannya dulu").
- [ ] **Penjualan per channel dan pelanggan.**
  - A customer can carry a channel: free text with suggestions *Marketplace*, *Reseller*, *Langsung*, set from the invoice list.
  - The receivables page shows sales (DPP of non-voided sales invoices) for the month and year to date, by channel, then by customer.
    Customers without a channel are grouped as *Tanpa channel*.

**Non-goals:**
- Importing a notes register file as invoices, and the review queue for undated or low-confidence notes (a later cycle builds on the
  invoice import).
- COGS by channel (needs item costs).
- Applying an advance automatically to a new invoice (it is offered, not applied).
- Posting the advance to a separate liability account automatically.

**Gate-reopeners:**
- Schema migration: `BankTransaction.contactId`; `Invoice.voidedAt`, `voidReason`, `voidEntryId`; `Contact.channel` (all additive,
  nullable).

**Assumptions:**
1. FIFO order: due date, then issue date, then number.
2. Advance = unmatched remainder of a contact-tagged line on the receivable/payable account. Nothing is posted; the GL already holds the
   cash on 1130/2110.
3. A void's mirror entry is dated on the original's date (same month), so the month's figures drop the document. A locked month refuses.
4. Channel is free text (trimmed, max 40), not an enum.

## Tasks
- [ ] T1 Schema + FIFO: migration; `settleFifo` in `lib/receivables/settle.ts` (contact tagging on every settle); action. Accept: DB
      tests (two notes paid by one receipt in FIFO order, a remainder kept, a line in Review classified first, withholding invoices
      cash-only, the refusals).
- [ ] T2 Advance and proof: `invoicesAt`/`subledgerVsLedger`/view with advances, *Belum dialokasikan*, the net-credit flag, and the
      close control. Accept: DB tests (overpayment → advance column, proof equal, control lists the contact; an untagged unmatched line
      still equals).
- [ ] T3 Void: `voidInvoice` + action + UI. Accept: DB tests (posted invoice reversed and leaves aging and proof; opening one only
      marked; settled refused; locked month refused; history).
- [ ] T4 Channel: `Contact.channel`, setter action, the sales-by-channel card. Accept: DB test of the totals; visual check.
- [ ] T5 Rules (5c), README, gates, review pass, ship.

## Implementation

## Verification

## Ship Notes

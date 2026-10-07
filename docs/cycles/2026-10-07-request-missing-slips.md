# The request to the client asks for the bukti potong customers still owe

## Context
A customer that withholds PPh 23 (or 22, 4(2)) from a payment owes the client a bukti potong. The slip is the client's credit against its
PPh Badan (PPh 23/22) or its proof of final tax (4(2)).

I5d now shows withholding in the books with no slip in an imported Coretax *diterima* list. The firm cannot fix that itself: the client
asks its customer. The data request (I1a, I1c) is the message that goes to the client, so the missing slips belong there.

Stage: **Sumber**.

## Spec
- [x] `dataRequest` takes `slips`, one line each: date, company, bank description, kind and PPh. The intro is *mohon mintakan bukti
  potong dari pelanggan untuk penerimaan berikut (dipakai sebagai kredit pajak)*; *Mohon juga* when other asks come first. Each slip counts
  as one item.
- [x] The import page fills it from `bupotRecon` per company: *diterima* withholding with no slip, and only once a *diterima* list was
  imported for the masa. Without one, Buku can't know which slips already arrived, so it asks nothing.

**Non-goals:** asking for slips the company owes others (the firm issues those in Coretax itself).

**Gate-reopeners:** none.

## Tasks
- [x] T1 The message part, the import page, a unit test and an e2e.

## Implementation
- `lib/controls/data-request.ts`: `MissingSlip` and the slips section.
- `app/(app)/clients/[id]/import/page.tsx`: slips from `bupotRecon`.

## Verification
- `tests/unit/data-request.test.ts`: slips only, and slips after a missing statement.
- `e2e/bukti-potong.spec.ts` (second test): a receipt booked with PPh 23 by the customer, a *diterima* list without its slip, then the
  request on the import page names it.

## Ship Notes
- No migration. Rollback: revert.

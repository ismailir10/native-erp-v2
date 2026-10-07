# I5e — A faktur not in the books, recorded as piutang or utang by one click

## Context
The ekualisasi (I5c) lists *faktur belum ada di buku*. For keluaran this is usually a sale invoiced but not yet paid: Buku books PPN when
the money arrives, while the faktur was issued at delivery. For masukan it is a supplier's bill not yet paid. In both cases the accountant
records it as a receivable or payable, by hand in Piutang & Utang, retyping what the faktur already says.

Stage: **Laporan** → **Pembukuan**.

## Spec
- [x] `bookFaktur` (`lib/tax/faktur.ts`) writes through the invoice writer (`createInvoice`, rule 5c), so the posting rules are unchanged.
  - Keluaran: Dr receivable / Cr the chosen revenue + 2130. Masukan: Dr the chosen expense or asset + 1150 / Cr payable.
  - Number, date, counterparty name and NPWP, DPP and PPN are the faktur's. Due 30 days after the faktur date.
  - The description names the faktur and its `file sheet!row`.
  - Refused for a faktur that isn't counted (cancelled, replaced, uncredited) and for one already recorded (same number in Piutang &
    Utang).
- [x] On the ekualisasi card, each *faktur belum ada di buku* row gets *Catat piutang* / *Catat utang*. A confirmation names the faktur
  and the journal, with the counter account to pick: the same choices as Piutang & Utang, default 4100 / 5100.
  - After it, the ekualisasi matches the faktur to the new invoice (same PPN, same NPWP).
  - The later payment settles it in Piutang & Utang.

**Non-goals:**
- booking from a faktur without the click;
- a bulk *catat semua*;
- withholding expected on the invoice (typed in Piutang & Utang if needed).

**Gate-reopeners:** none (no migration).

## Tasks
- [x] T1 `bookFaktur` + action + the button and dialog. DB test: the journal, the tie after booking, never twice, never a cancelled
  faktur. E2e: book the unbooked faktur in `e2e/ekualisasi-ppn.spec.ts`.

## Implementation
- `lib/tax/faktur.ts`: `bookFaktur`.
- `app/actions.ts`: `bookFakturAction`.
- `components/app/faktur-recon.tsx`: `BookFaktur`, with the account choices from the page.

## Verification
- `tests/db/faktur.test.ts` "records a faktur not in the books as a receivable by click…":
  - the journal is 1130 22.200.000 / 4100 20.000.000 / 2130 2.200.000, due 24 Sep;
  - the ekualisasi then matches the faktur to the invoice;
  - a second booking and a cancelled faktur are refused.
- `e2e/ekualisasi-ppn.spec.ts`: *Catat piutang* in the row, and the banner moves to the one receipt without a faktur. The faktur shows in
  Piutang & Utang.

## Ship Notes
- No migration. Rollback: revert.

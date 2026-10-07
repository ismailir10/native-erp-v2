# Beranda: a masa paid short or late is its own task

## Context
Beranda's *Perlu dikerjakan* ranks what blocks the books across clients. A tax masa paid short or late (control `masa:<entity>`, REVIEW)
showed up only inside "Periksa N temuan tutup buku". Yet it is the item with a deadline and a penalty (STP bunga per month), the one an
Indonesian firm chases first.

Stage: across clients (firm board, I5a).

## Spec
- [x] Each unacknowledged REVIEW `masa:` control of a client past setup becomes a high-priority task *Periksa setoran pajak {company}*.
  Its detail is the control's sentence, which names the tax, the masa, the shortfall and its due date, and it links to Pajak Masa.
- [x] Ranked with missing statements, after failed controls and before review. A note on the control (acknowledged) or the payment
  removes it.

**Non-goals:**
- a tax calendar of upcoming due dates (a masa not yet due is not a problem);
- Coretax differences (`faktur:`, `bupot:`), which stay inside the close count.

**Gate-reopeners:** none.

## Tasks
- [x] T1 `lib/workspace/index.ts` (`taxIssues`, task, rank) + DB test.

## Implementation
- `lib/workspace/index.ts`: `taxIssues` from the client's controls; a `tax:` task each; rank 1.

## Verification
- `tests/db/workspace.test.ts`: July PPh 21 withheld and not paid by 15 August gives the task, with its detail and link. The payment on
  14 August removes it.

## Ship Notes
- No migration. Rollback: revert.

# 0013 — Removing an import, and the change log

**Context.** The owner's use-case document (UC-K4) asks that removing an import removes its journals and returns the reports to where they
were, and that every change carries who, when and from what to what (UC-C8). Accounting-rules rule 3 makes posted entries immutable
(corrections are new entries); the only removal so far is deleting a whole client entered by mistake. A wrong statement file (another
account, another year, a duplicate period) could not be taken back.

**Decision.**
1. **An import is removed, not reversed.** An admin removes one posted bank-statement or ledger/Neraca import with a written reason
   (≥ 10 characters): its bank lines, every journal they or the file produced (bank, reclass, posted corrections) and their drafts, in one
   transaction under the client's close lock. Reversal was rejected. It would leave the bank lines in place, so the corrected file could
   never be imported again (rows dedupe by hash), and every reader of bank lines would have to learn to skip voided ones.
2. **Only in open months, only when nothing else rests on it.** Refused when a month it touches is closed (reopen first, which is itself
   logged), when a line settles an invoice, or when a fixed asset or adjustment schedule was made from one of its journals. A transfer
   partner in another import is unlinked and stays where it is, so the clearing control shows the open half.
3. **The removal is permanent history.** An `AuditEvent` keeps the file, account, period, rows, money in and out, journals removed, the net
   taken off each account, the reason, who and when.
4. **Riwayat perubahan.** `AuditEvent` (append-only, a DB trigger refuses updates) is written in the same transaction as:
   - a reviewer's change to a bank line's account or tax;
   - unpairing a transfer;
   - removing an import;
   - writing or replacing a control note (the old note is kept);
   - remapping a source account;
   - resolving a Temuan.

   Journal entries keep carrying who posted them; periods keep `PeriodUnlockLog`.

**Consequences.** Rule 3 has two named exceptions (delete a client; remove an import), both admin only and logged. Memory learned from
removed lines stays (it describes counterparties, not the file). Reports never show a removed import; the log does.

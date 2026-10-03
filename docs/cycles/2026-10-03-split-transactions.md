# Split a bank line across accounts (pecah transaksi)

## Context
Use-case feedback UC-B3 ("Keranjang 6101"): Belifi pays combined transfers, such as "gaji + ongkos produksi" Rp 200 juta in one bank
line, that the owner then breaks down. Buku can only put a bank line on one account, so the accountant either posts the whole amount to
one account (wrong expense split) or adds manual adjustments that drift from the bank row.

UC-B3 step 3 asks to *pecah transaksi gabungan menjadi beberapa akun*, with this pass condition: "Pemecahan wajib seimbang: jumlah
bagian = nominal asli, jika tidak ditolak dengan pesan."

The posting model already supports it: the bank side is posted once, and the classification side moves by RECLASS entries that post only
the difference (`lib/ledger/bank.ts`). A split is a classification side with several accounts. Every line keeps `bankTransactionId`, so
each part still drills to the same bank row (rule 5).

## Spec
- [ ] **Pecah transaksi.**
  - A reviewer splits a bank line into two or more parts (account + amount + optional note) from Review and from Buku Besar's line
    dialog.
  - The parts must add up exactly to the line's amount. Otherwise the split is refused naming the difference: "Jumlah bagian Rp 190.000.000
    belum sama dengan nominal mutasi Rp 200.000.000 (kurang Rp 10.000.000)."
  - Amounts are typed like other money fields (`parseMoney`, the line's currency), each greater than zero.
- [ ] **Posting.**
  - The classification side becomes one leg per part, posted as a RECLASS of the difference from what was there. The bank leg never
    changes.
  - Every leg keeps `bankTransactionId`, so each part drills to the bank row; the TB, Laba Rugi and Neraca move by the parts.
  - Re-splitting posts only the difference again. Choosing a single account in Review or Buku Besar replaces the split (the parts go).
- [ ] **What a split refuses** (each with a Bahasa message saying what to do):
  - a part on 1999 Belum Terklasifikasi or on the transfer/intercompany accounts (1199 / 1190);
  - a line paired as a transfer (unpair first);
  - a line that settles invoices or carries withholding (those own the classification);
  - a locked month;
  - fewer than two parts, or a duplicate account.
- [ ] **Bookkeeping around it.**
  - The line becomes REVIEWED and MANUAL with the reason "Dipecah ke n akun". Its `accountCode` is the largest part, so filters and the
    6101 leakage control still see one account.
  - Memory and rules never learn from a split (a combined transfer is a one-off).
  - The transfer matcher never pairs a split line.
  - The split is recorded in the history (CLASSIFY, before/after with the parts).
  - Any other path that would re-post the line with one account (settling, the transfer matcher, suspense tools) is refused while the
    split stands, so the parts can't silently vanish.
- [ ] **Seen where it matters.**
  - Review and Buku Besar show a split line as "Dipecah: 6101 Rp 120.000.000 · 5110 Rp 80.000.000".
  - Each part's ledger line links back to the bank row, as today.

**Non-goals:**
- Tax tags (PPN) or withholding on individual parts. A line with withholding or a PPN tag can't be split; split first, then add tax by
  journal.
- Splitting by percentage, and saving a split as a rule.
- The owner question list export (UC-B3's other item).
- Splitting ledger-import (GL file) lines.

**Gate-reopeners:**
- Schema migration: a new table `BankTxSplit` (bankTransactionId, position, accountCode, amount > 0 CHECK, memo), additive.

**Assumptions:**
1. A part's amount is entered as a positive magnitude; its side follows the bank line (money out → debit parts).
2. `accountCode` on the bank line holds the largest part (ties: the first) for filters and controls; the parts are the truth for posting.
3. Any member (not only an admin) can split, like any review decision.

## Tasks
- [x] T1 Model + posting: `BankTxSplit` (migration, CHECK, client delete), `classificationNets` for parts, `splitTransaction` in
      `lib/review.ts` with every refusal, the guard in `postBankTransaction`, `reviewTransactionTx` clearing a split, and the matcher
      skipping split lines. Accept: DB tests for a 200 jt line split 120/80 (GL by part, drill by `bankTransactionId`), a re-split
      posting only the difference, back to one account, each refusal, and TB balance.
- [x] T2 UI: *Pecah* in Review and in Buku Besar's dialog (rows of account + amount + note, running remainder, save enabled only when
      balanced, server refusal verbatim); split lines shown with their parts. Accept: visual check at 1280 / 390 px; action test.
- [ ] T3 Rules (rule 5/14 note), README, end-of-cycle gates, review pass, ship.

## Implementation
- T1:
  - `BankTxSplit` (position, accountCode, positive amount with a CHECK, memo) via migration `20261003080000_bank_tx_split`. It cascades
    with its bank line, so import removal and client deletion need no change.
  - `classificationNets` takes `parts` (credits for money in, debits for money out).
  - `postBankTransaction` refuses a one-account posting of a split line.
  - `splitTransaction` (`lib/review.ts`):
    - refuses a paired line, a settling line, a line with tax, fewer than two parts, an unknown, unclassifiable, 1999/1199/1190 or
      duplicate account, a non-positive or unreadable amount, and parts that don't add up (naming the gap, "kurang/lebih");
    - replaces the parts, posts the difference, marks the line REVIEWED/MANUAL "Dipecah ke n akun" with the largest part as its
      `accountCode`, and records CLASSIFY;
    - never touches Memory or rules.
  - `reviewTransactionTx` clears a split before a one-account decision, and history shows the parts it came from.
  - The transfer matcher's candidate query skips split lines.
  - `splitTransactionAction` (scoped by `assertTxInFirm`).
- T2: `components/app/split-dialog.tsx`:
  - `SplitDialog` has rows of account (1999/1199/1190 left out), amount and note, with *Tambah bagian* pre-filling the remainder.
  - A live "Sisa / Lebih / Seimbang dengan mutasi" line shows the remainder (review colour until zero), and an unreadable amount is
    outlined in fail colour.
  - *Simpan pecahan* is enabled only when balanced with every part filled; the server's refusal is shown verbatim.
  - `SplitSummary` shows "Dipecah: …".

  Where it appears:
  - Review: *Pecah* on every card; a saved split leaves the queue.
  - Buku Besar line sheet: *Pecah* / *Ubah pecahan* (pre-filled) beside *Ubah akun* for unpaired lines, a *Bagian* row with the parts,
    and a note that *Simpan* with one account merges the split back.
  - `accountLedger` returns the parts on the source.

  Assumption change: a Review line's `taxTag` is only a suggestion (its posting sits on 1999), so the tax refusal applies only to
  posted tax (status ≠ NEEDS_REVIEW, or withholding).

## Verification
- T1: `tests/db/split-transactions.test.ts` → `Tests 2 passed (2)`:
  - 200 jt → 6100 120 jt + 5110 80 jt by `bankTransactionId`; status, reason and parts checked; Neraca balances; no Memory; history
    summary checked;
  - a re-split is one RECLASS of ±20 jt;
  - a one-account re-post is refused, and Review's one-account decision replaces the split (6100 200 jt, no parts left);
  - each refusal message, and a locked month.

  Lint + typecheck clean; `npm test` → `Test Files 157 passed (157) · Tests 1043 passed (1043)`.
- T2: the split test adds the tax cases (a posted PPN line is refused; after one-account review without tax it can be split).
  Visual check (dev server, demo Grup Ayam Nusantara, Review Agustus 2026):
  - the 185 jt "AGRO TEKNIK … MESIN PAKAN" line split 1210 150 jt + 6150 30 jt shows "Sisa Rp 5.000.000" with save disabled;
  - at 35 jt it reads "Seimbang dengan mutasi", saves, and leaves the queue;
  - Buku Besar 1210 shows the line with "Dipecah: 1210 Rp 150.000.000 · 6150 Rp 35.000.000", the history entry, and the RECLASS
    journal (1999 Cr 185 jt, 1210 Dr 150 jt, 6150 Dr 35 jt);
  - at 390 px the dialog stacks and there is no horizontal scroll; at 1280 px each part is one row.

  Lint + typecheck clean; `npm test` → `Test Files 157 passed (157) · Tests 1043 passed (1043)`.
- T3:
  - Rule 3 amended (split lines) and the README Classify row updated.
  - End of cycle:
    - `npm run lint && npm run typecheck && npm test` → `Test Files 157 passed (157) · Tests 1043 passed (1043)`;
    - `npm run build` passes;
    - `npm run demo:reset && npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`;
    - e2e runs in CI.

## Ship Notes

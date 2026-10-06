# I1c — The request to the client also asks about unclear transactions

## Context
I1a's request card asks the client for missing statements and ledger exports. A firm's other weekly question to a client is "what
was this payment?" for the lines Buku can't classify alone. Buku already lists them:
- `ownerQuestions` (UC-B3) gives every line still in Review, largest amount first;
- Review exports it as an Excel sheet with an answer column.

Today the accountant sends two messages: one for the files and one for the questions. One message is what a client actually answers.

Approved under "get them done" (2026-10-06).

## Spec
- [x] `dataRequest` takes the open questions.
  - After the missing data, it adds: "Mohon juga penjelasan transaksi berikut: dari/ke siapa dan untuk apa".
  - It lists up to 10 lines, largest first: date, account, the bank's description (80 characters at most), and *masuk/keluar* with
    the amount.
  - When there are more, it adds "…dan N transaksi lain; daftar lengkapnya kami kirim dalam file Excel."
- [x] A message is drafted when either section has something to say. The card's count includes both sections.
- [x] The import page reads the questions for the client through the selected month (all entities), as Review's export does.

**Non-goals:**
- sending the Excel automatically;
- receiving answers;
- changing Review.

**Gate-reopeners:** none.

**Assumptions:** 10 lines keep the message readable on a phone. The Excel stays the full list.

## Tasks
- [x] T1 `dataRequest` questions section + unit tests (only questions, both, more than ten). Import page passes `ownerQuestions`.
  Accept: tests pass, and the demo message for Grup Ayam lists its August review lines.
- [x] T2 Gates. Accept: lint, typecheck, test, build and verify:books pass (e2e in CI).

## Implementation
- T1: `lib/controls/data-request.ts`. `dataRequest` takes `questions` (`OwnerQuestion[]`) and returns `{ text, items }`. The second
  section lists up to `MAX_QUESTIONS` (10) lines lettered a–j: date, bank account, description (80 characters at most), and masuk or
  keluar with the amount. It points to the Excel for the rest, and it opens the message itself when nothing is missing.
  `app/(app)/clients/[id]/import/page.tsx` reads `ownerQuestions` through the month for all entities. `tests/unit/data-request.test.ts`
  (+1).
## Verification
- Demo, Grup Ayam, August 2026: 5 items, the missing BRI statement, then a–d: the Rp 185 jt machine payment, the Rp 60 jt down
  payment, the Rp 15 jt tax consultant and the Rp 7,25 jt hospital payment, largest first.
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 170 passed (170), Tests 1120 passed (1120);
  `npm run build` exit 0; `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
## Ship Notes
- No migration or env var. Rollback: revert.

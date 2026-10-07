# End-to-end usability test on production with real client files

## Context
The owner asked for a hard end-to-end usability test in production, with AI calls, using real client files from the shared Drive
(2026-10-08), and to fix whatever an Indonesian accountant would find wrong. Two clients were walked from nothing:

- **Belifi** (PT + owner as a separate entity): BCA giro e-statement for June 2026 → Saldo Awal → Review (AI) → reports → close.
- **Goers** (PT, books in Jurnal.id): the Neraca per 31 May 2026 as the opening → mapping → reports → close (AI review) → Tanya Buku.

The statement parsed with continuity intact and the Neraca reconciled to the file to the rupiah. What broke is listed below.

Stage: **Sumber** (classification), **Buku Besar** (Saldo Awal), **Laporan** (reports, close, Tanya Buku).

## Spec
- [x] **AI classification finishes on a reasoning model.** The output cap `1 500 + 60 × items` truncated minimax-m3 at 19 real bank lines
  (2 640 tokens), on import and on *Minta saran AI*, so every line fell back to the simple guess. The cap is now `6 000 + 150 × items`,
  at most 12 000. The reservation still settles to actual usage and the monthly budget still caps the total.
- [x] **Transfers to the group's owner are not expenses.** The PT's transfers to its owner (an entity of the same client) went three ways:
  one to 1190, the others to the simple guess *6190 Beban Umum* (Rp 467 jt):
  - a company is named without its legal form ("Belifi" for PT Belifi): legal forms are taken out of own names, and a "PT" printed
    before an own name goes with it;
  - channel words (BCA's "BIF") are not a third party;
  - an own entity named with only a short code beside it ("… ALFI YANDRA KBB") waits in Review on 1190 (0.8), never posts.
- [x] **Laba Rugi header** for a month at the Saldo Awal said "1 Juni – akhir Mei 2026"; it now says when the books start.
- [x] **Pajak masa disetor** said "Masa April 2026 disetor penuh" for a month before the books existed. A masa that ended before the Saldo
  Awal or imported Neraca, with no payment seen in Buku, now says it can't be checked here. An opening dated the masa's last day is still
  that masa's payable.
- [x] **Saldo Awal date** for an entity without statements (the owner) defaulted to the end of last calendar month (30 Sep 2026). It now
  starts with the group: the earliest sibling Saldo Awal or first statement.
- [x] **AI close review of *Defisiensi modal*** received no rows ("baris ledger kosong"). It now gets the year's result, the equity accounts
  and the client's own accounts behind them.
- [x] **Tanya Buku answers a balance by account name** ("utang ke pihak berelasi", "piutang karyawan"), in either language, over Buku's chart
  and the client's imported accounts. A question about cash and a named account answers both.
- [x] **CALK** said the statements cover "1 Januari – 31 Mei 2026" when the books start on 1 June; it now covers the months from the Saldo
  Awal (the opening month reads as a position). A deferred tax **asset** estimated for an entity with a fiscal loss, losses carried forward
  or a capital deficiency carries the recoverability caveat (SAK EP Bab 29): the Goers note proposed Rp 620.993.858 on employee benefits.

**Non-goals:** mapping related-party payables to their own account; Kelengkapan heading wording; Perorangan's default framework.

**Gate-reopeners:** none (no migration, no dependency).

## Tasks
- [x] T1 AI output budget (`lib/ai/provider.ts`), test.
- [x] T2 Own names and owner transfers (`lib/classify/transfer.ts`, `lib/import/normalize.ts`), tests.
- [x] T3 Report label, masa control, Saldo Awal date (`app/(app)/clients/[id]/reports/page.tsx`, `lib/controls/index.ts`, `lib/opening.ts`), tests.
- [x] T4 Going-concern rows for the AI close review (`lib/controls/ai-review.ts`), test.
- [x] T5 Tanya Buku by account name (`lib/workspace/index.ts`), tests.
- [x] T6 CALK period and deferred-tax caveat (`lib/reports/notes.ts`), test.

## Implementation
- T2: the review-only 1190 branch runs after the paired and hinted branches, only for lines with a transfer word that name another own
  entity and leave nothing longer than three letters; a bank fee line on the same transfer is left to the firm rule.
- T5: `accountsNamed` scores each candidate by the question's words found in its name (prefix match, ID↔EN synonyms); only the best
  score counts, and only from two words up, so "saldo bank" alone still means the cash answer.

## Verification
- Local: `npm run lint`, `npm run typecheck`, `npm test` (see the PR).
- Production, after deploy: re-import the Belifi statement (owner transfers on 1190, AI suggestions present), the Goers Neraca month
  (header, masa control), Tanya Buku "utang ke pihak berelasi".

## Ship Notes
Real client files stay in `data/private/` (gitignored); tests use invented names.

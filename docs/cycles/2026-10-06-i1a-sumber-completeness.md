# I1a — Sumber: completeness first, then the request to the client

## Context
ADR 0014's first stage is **Sumber**: the client's files are in, complete and proven before anyone reviews a line. Most of a firm's
lost time sits before Buku sees a file. Staff chase missing statements over WhatsApp, a month at a time, and only notice a missing
month at close.

Buku already has the grid. `completenessMatrix` (`lib/controls/completeness.ts`, UC-B4) marks every bank account × month as *ada*,
*bolong* or *tidak nyambung*. But it only shows on **Tutup buku**, at the end of the month, which is where a gap costs the most.
It also says nothing about clients whose books come from a ledger export (Jurnal, Accurate, Zahir) rather than bank statements.
And after finding the gaps, the accountant still has to type the request to the client by hand.

The owner approved working through the plan ("get them done", 2026-10-06), so this cycle is built without a separate approval stop.
It is one slice of I1 that doesn't depend on the real-month results. The inbox, AI sorting and the client upload link wait for that
month's blocker log (ADR 0014).

QA E18 (a 20-digit amount crashing an import) turned out to be fixed already. BUG-010 in the pipeline refuses it with the row
number (`tests/db/import-twin-rows.test.ts`), so it is out of scope. The I0 Ship Notes listed it as open; this cycle corrects that.

## Spec
- [x] **Kelengkapan on the Sumber page.** **Impor Mutasi** opens with the grid for the chosen month (six months back). When there are
  gaps, it is followed by the request card. Tutup buku keeps the grid as it is.
- [x] **Ledger-fed books in the grid.**
  - A client with a posted ledger import (*Buku besar*, or a *Neraca saldo* with movement) gets one row, *Buku besar (file)*.
  - A month is *ada* when a posted ledger or TB import's period covers it, and *bolong* when a month after the first covered one
    has none.
  - A Neraca-only import (an opening) covers no month.
- [x] **Request to the client** (`lib/controls/data-request.ts`, pure). A polite Bahasa message built from the grid lists only what is
  missing or broken:
  - per account, missing months grouped into ranges ("April–Mei 2026");
  - a *tidak nyambung* month names the difference, or the file whose running balance breaks, and asks for the complete file;
  - the ledger row asks for the export of the missing months;
  - the closing asks for a PDF e-statement or a CSV/Excel export from internet banking rather than photos.
  The card shows the text with **Salin pesan** (clipboard, with a select-all fallback) and **Kirim lewat WhatsApp** (a
  `https://wa.me/?text=…` link the accountant sends to the client's contact). No message when nothing is missing.
- [x] Copy in Bahasa, ui-rules look (shadcn Card, mono micro-labels, one primary action).

**Non-goals:**
- the inbox;
- AI sorting;
- the client upload link without login;
- storing a contact phone number;
- sending anything automatically;
- changing what *ada / bolong / tidak nyambung* mean for bank accounts.

**Gate-reopeners:** none. No migration, no dependency, no AI.

**Assumptions:**
1. "Bapak/Ibu" is the salutation. The firm's name signs the message (from the session firm), and the client's name is in it.
2. Months shown are the six months up to the selected period, the same window as Tutup buku.
3. The WhatsApp link carries the text only. The accountant picks the contact in WhatsApp.

## Tasks
- [x] T1 Ledger row in `completenessMatrix` + DB tests (covered, missing after the first covered month, Neraca-only ignored, a
  draft import ignored). Accept: `tests/db/completeness.test.ts` passes.
- [x] T2 `dataRequest()` + unit tests (ranges across a year end, broken with and without a difference, ledger row, nothing missing →
  null). Accept: unit tests pass.
- [x] T3 Import page: grid + request card (server data, client copy button). Accept: page screenshot reviewed; a DB/e2e check that
  the card appears for a client with a gap.
- [x] T4 End-of-cycle gates. Accept: lint, typecheck, test, build and verify:books pass (e2e runs in CI).

## Implementation
- Plan: T1–T4 sequential, inline (small; T3 depends on T1–T2).
- T1: `lib/controls/completeness.ts`: rows carry `kind`. One *Buku besar (file)* row (`LEDGER_ROW_ID`) comes from posted imports
  with `mode = LEDGER` or a TB (`data.tb`). The rule is filtered in the database, so the import payloads are never loaded. A month
  is *ada* when such an import's period covers it, and *bolong* from the first covered month on. Tests: `tests/db/completeness.test.ts`
  (+2).
- T2: `lib/controls/data-request.ts` (`dataRequest`, `monthRanges`) + `tests/unit/data-request.test.ts`. Accounts read "Rekening koran
  BRI Simpedes a.n. Budi (Pemilik)": entity short names often carry their own parentheses, and *a.n.* is how banks write it.
- T3: `components/app/data-request-card.tsx` (client: editable text, *Salin pesan* with a select-all fallback, *Kirim lewat WhatsApp*
  as a `wa.me` link, both outline buttons so the upload stays the one primary action). `components/app/completeness-card.tsx` is now
  titled *Kelengkapan data*, and its import link is optional. `app/(app)/clients/[id]/import/page.tsx` shows the grid and the card
  above the upload. E2e: `e2e/investor-demo.spec.ts` checks the grid shows *Bolong* and the message names August before the live
  upload. `docs/demo/investor-demo.md` gets one line.
## Verification
- Demo data: Grup Ayam's grid reads BCA/Mandiri/BCA Tahapan ok for Mar–Aug and BRI Simpedes ok…ok, **missing** in August. The
  message is "1. Rekening koran BRI Simpedes a.n. Budi (Pemilik): Agustus 2026." (printed with `completenessMatrix` + `dataRequest`
  against the seeded database).
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 166 passed (166), Tests 1103 passed (1103);
  `npm run build` exit 0; `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- **Not seen in a browser here.** The sandbox has no Supabase Auth keys, so the page can't be opened logged in. The new e2e
  assertions run in CI against a real login. `test:e2e` itself is not run locally, for the same reason.
## Ship Notes
- No migration, env var or manual step. Rollback = revert the commits.
- I0's Ship Notes listed QA E18 for I1; it was already fixed (BUG-010).

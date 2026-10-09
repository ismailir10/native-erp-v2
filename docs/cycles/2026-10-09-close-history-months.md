# Close the history: lock many past months in one pass

## Context
A client migrated with years of history (a ledger file from Jurnal / Accurate, or 12+ months of statements) arrives with every past month
open. Closing goes in order (rule 23, `earlierOpenMonth`), so before the accountant can close the month they actually work on, each past
month needs its own visit: read the controls, write a note on every *Perlu dicek*, tick three sign-offs, click *Tutup buku*. Chickin needed
36 of those (`2026-10-08-chickin-bank-e2e.md`, Non-goals: "proposed as a follow-up"). That is an afternoon of clicking that adds no
judgement: for history the judgement is one decision ("these months were kept and closed in the old system; Buku carries them as they
were"), written once.

Outcome: on *Tutup Buku* for a month with two or more open months before it, the accountant sees those months in one card — what each one
still flags — writes one note, confirms the three sign-offs once, and Buku closes them in order, month by month, with a progress bar. A
month with a failed control stops the run there, named, and nothing after it closes.

Approval: the owner's brief in-session ("continue improving Buku until we are proud with our work") is the go-ahead, same pattern as the
earlier owner-briefed cycles.

## Spec
- [x] **H1** *Tutup Buku* shows a card *Tutup bulan-bulan sebelumnya* when at least two months before the selected month are open and hold
  entries other than a Saldo Awal (the months `earlierOpenMonth` would make you close first). It names the range and count and offers
  *Periksa N bulan*.
- [x] **H2** *Periksa* runs the controls of those months in order (earliest first) and shows one row per month: *Siap* (nothing open),
  *k kontrol perlu catatan* (the REVIEW controls without a note, titles listed), or *Gagal* with the failed controls. It stops at the first
  month with a failed control: that month and the ones after it are listed as not part of this run ("Perbaiki <bulan> dulu"). A summary
  groups the controls to be noted by title across months ("Rekonsiliasi BCA Giro · 12 bulan"), so the accountant reads what the note
  will answer.
- [x] **H3** One note (min. 10 characters) and the three sign-off statements, confirmed once, apply to every month in the run. Buku then
  closes the months one at a time in order (one server call per month, progress "Menutup Mar 2024 · 4 dari 12"): writes the note on each
  REVIEW control without one (`saveControlNote`, so each lands in Riwayat as a control note), records the sign-offs by the person, and
  locks through `lockPeriod` (rule 23 unchanged: no FAIL, every REVIEW noted, all sign-offs). The lock note reads *Ditutup bersama
  bulan-bulan sebelumnya: <note>*.
- [x] **H4** Safety: a month whose open controls differ from what was checked (fingerprint of key + detail of the REVIEW controls to note)
  is refused with "Kontrol <bulan> berubah sejak diperiksa. Periksa ulang." and the run stops; so does a month that gained a failed
  control. Months closed before the stop stay closed. Admin only (the batch signs off many months at once); an akuntan sees who can.
  Locked months are never touched; the selected month itself is not part of the run (it is closed as today).
- [x] **H5** Riwayat shows one event per month closed this way (*Tutup buku bersama*, the note, by whom) next to the control notes.

**Non-goals:** closing the selected month in the same run; skipping controls or sign-offs for history; reopening many months at once;
changing the controls themselves; closing empty months (they never block).

**Gate-reopeners:** none — no migration (`AuditEvent.kind` is a string), no dependency, no AI call. Rule 23 is applied per month as
today; only the way the note and sign-offs are given changes (once for the run).

**Assumptions:**
1. Admin-only, because one confirmation signs off many months.
2. The note applies only to REVIEW controls without a current note; an existing note is kept.
3. Driving the run from the browser one month per call keeps every call well under the 300 s function limit and shows progress; a
   closed tab stops the run between months, which is safe (each month is complete or untouched).

## Tasks
- [x] T1 `lib/controls/history.ts`: `historyMonths` (open months with activity before a month), `historyPreview` (per-month status,
  stop at first FAIL, fingerprints), `closeHistoryMonth` (fingerprint check, notes, sign-offs, lock, audit event) — accept:
  `tests/db/close-history.test.ts` (two months noted and locked in order; changed control refused; FAIL stops; existing note kept;
  akuntan refused at the action).
- [x] T2 Server actions + `components/app/close-history-card.tsx` on the Tutup Buku page — accept: e2e `close-history.spec.ts` (a client
  with three open months closes the first two from the third month's page; Riwayat shows the events); screenshot looked at, desktop + 390 px.
- [ ] T3 End-of-cycle gates, docs (README *Close* row, accounting-rules 23 line), Ship Notes.

## Implementation
- Plan: T1–T3 sequential, inline (one domain module, one card, docs; nothing independent enough to delegate).
- T1: `lib/controls/history.ts` (`historyMonths`, `historyPreview` — controls run 4 months at a time, stops at the first FAIL, groups the
  controls to note by title · scope; `closeHistoryMonth` — admin, note ≥ 10, before the selected month, order checked before any write,
  FAIL refused, fingerprint of the REVIEW controls without a current note must match the preview, then notes via `saveControlNote`,
  sign-offs by the actor, `lockPeriod`, one `HISTORY_CLOSE` event), `lib/audit.ts` (*Tutup buku bersama*), `app/actions.ts`
  (`historyPreviewAction`, `closeHistoryMonthAction` — revalidates once, on the last month). Found while testing: an out-of-order call wrote
  its notes before `lockPeriod` refused, so the order check now runs first. Test: `tests/db/close-history.test.ts` (5).
- T2: `components/app/close-history-card.tsx` (Periksa → per-month rows with *Siap* / *k perlu catatan* / *Gagal*, the stop and the
  months waiting behind it, the controls the note answers grouped across months, note + the three sign-offs "untuk setiap bulan", confirm
  dialog, progress "Menutup <bulan> · i dari n", stops on the first refusal with what closed), `close/page.tsx` (card when ≥ 2 open months
  with activity before the selected one and it is open; NextStep says they can be closed together). Test: `e2e/close-history.spec.ts`
  (three accruals Apr–Jun on a new client; from June: preview, button disabled until note and sign-offs, close, toast, card gone, April
  locked, Riwayat event; 390 px without page overflow). Screenshots looked at, desktop and phone.
- T3 docs: README *Close* row, accounting-rules 23.
## Verification
- T1: lint clean · typecheck clean · `npm test` 194 files, 1312 passed.
- T2: lint clean · typecheck clean · `npm test` 194 files, 1312 passed · e2e close-history 1 passed.
## Ship Notes

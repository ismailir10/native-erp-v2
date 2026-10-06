# I5a — Papan kantor: every client's month by stage

## Context
ADR 0014 names a firm-level close board as the one screen incumbents don't have. With it, a firm with 30 clients sees at a glance
where each client's month stands: files in, reviewed, closed, sent.

Beranda already lists clients with a close state (*Kemajuan tutup buku*, `WorkspaceClose`). But it shows one pill per client: closed,
failing, or "perlu dicek". It doesn't show whether the files are complete, or whether a closed month's report has gone out. So the
firm still asks each accountant where each client stands.

This cycle turns that list into the stage board, using what Buku already computes:
- completeness (I1a);
- the review queue;
- the close state;
- the `REPORT_EXPORT` log (I0).

Approved under "get them done" (2026-10-06).

## Spec
- [x] **Papan kantor** replaces the list in *Kemajuan tutup buku* on Beranda. The progress bar and count of closed clients stay
  above it, and companies come before individuals. Each client is one row with four stage cells:
  - **Sumber:**
    - *Lengkap* when no account or ledger row is *bolong* or *tidak nyambung* for the month;
    - *n kurang* (review colour) otherwise;
    - *Belum ada data* when the client has no rows.
    - It links to the client's Impor page, where the request card is.
  - **Review:** *n transaksi* (review colour) while lines wait, else *Selesai*. It links to Review.
  - **Tutup buku:** the existing state (*Buku ditutup / Siap tutup buku / Perlu dicek / Kontrol gagal / Belum ada jurnal bulan ini*).
    It links to Tutup Buku.
  - **Terkirim:**
    - once the month is locked, the date of the first report downloaded after the lock;
    - *Belum dikirim* when locked but nothing has gone out;
    - "–" before the lock.
- [x] `getWorkspaceOverview` returns per client `sumber: { gaps, rows }` and `sentAt`. The Sumber cell reads the selected month only:
  `completenessMatrix(…, 1)`. `sentAt` comes from one `REPORT_EXPORT` query for all clients in scope.
- [x] Status is shown with an icon, a label and a colour (`StatusPill`), problems first in each cell, and the layout holds at 390 px.
  On a phone each client is a stacked card with labelled cells, with no horizontal page scroll.

**Non-goals:**
- a separate board page;
- filters or sorting controls;
- notifications;
- assigning accountants to clients (no such data yet).

**Gate-reopeners:** none.

**Assumptions:**
1. "Terkirim" means a report downloaded after the lock. Buku can't see whether it was e-mailed. The timeline (I0) uses the same
   definition.
2. The board lives where the close list was, so Beranda keeps one place for close status.

## Tasks
- [x] T1 Data: `sumber` and `sentAt` per client in `getWorkspaceOverview` + DB test (gap counted, the ledger row counts, `sentAt` only
  after the lock). Accept: `tests/db/workspace.test.ts` passes.
- [x] T2 `WorkspaceClose` becomes the stage board (table from `md`, stacked cards below). Accept: lint/typecheck; e2e still finds
  Beranda's elements.
- [x] T3 Gates. Accept: lint, typecheck, test, build and verify:books pass (e2e in CI).

## Implementation
- Plan: T1–T3 sequential, inline.
- T1: `lib/workspace/index.ts`: each client gets `sumber` (`completenessMatrix(…, 1)`: rows, and rows with a *bolong* or *tidak
  nyambung* month), `sentAt` (the first `REPORT_EXPORT` for `period:YYYY-MM` at or after `lockedAt`, as `close:timeline` reads it),
  `importHref` and `reviewHref`. Test: `tests/db/workspace.test.ts` (+1). It covers a gap, a draft sent before the lock that doesn't
  count, and the first one after the lock that does.
- T2: `components/app/workspace-overview.tsx`: `WorkspaceClose` is the board, with four stage cells per client, each a `StatusPill`
  linking to where it's fixed. It is a table from `md` and stacked labelled cells below. `app/(app)/page.tsx`: the board takes the full
  width under the task list (four columns don't fit the old half-width column).
  - E2e: the investor walk checks the board shows Grup Ayam's *1 kurang*.
  - `docs/demo/investor-demo.md` step 1 gets one line.
## Verification
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 167 passed (167), Tests 1109 passed (1109);
  `npm run build` exit 0; `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- Not seen in a browser here (no Supabase Auth keys). The e2e assertion runs in CI.
## Ship Notes
- No migration or env var.
- Beranda now does one completeness read per client in scope (bank accounts × one month), next to the controls it already runs per
  client. Watch Beranda's response time on the real workspace once there are many clients.

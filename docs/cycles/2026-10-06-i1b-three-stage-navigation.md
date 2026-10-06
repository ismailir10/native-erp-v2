# I1b — Three-stage navigation, modules per client

## Context
ADR 0014 restructures each client around **Sumber → Buku Besar → Laporan**. Today the client menu is one flat list of 14 pages
(`components/app/app-sidebar.tsx`, `ACCOUNTING`). It puts the PSAK and subledger modules (Piutang & Utang, Persediaan, Aset Tetap,
Sewa, Imbalan Kerja) next to the daily close steps for every client, including those that will never use them. That breaks "don't
make me think" for a firm closing 30 small clients.

The owner approved the defaults (ADR 0014 §6: PSAK modules become per-client toggles) and asked to work through the plan ("get them
done", 2026-10-06). The pages stay where they are. Only the way in changes.

## Spec
- [x] **The client menu shows three stages**, each with a micro-label, in working order:
  - **1 · Sumber:** Impor Mutasi, Saldo Awal.
  - **2 · Buku Besar:** Review transaksi, Buku Besar, Neraca Saldo, Jurnal Penyesuaian, the client's modules, Tutup Buku.
  - **3 · Laporan:** Laporan Keuangan, Pajak Badan.

  The first-run order (Impor → Saldo Awal → Review → Tutup buku, ui-rules 14) reads top to bottom, and nothing in it is collapsed.
  Ringkasan klien stays first, and *Pengaturan klien* (Kurs, Aturan klasifikasi, Riwayat perubahan) stays collapsible. Every label
  and URL is unchanged, so links, bookmarks and e2e keep working.
- [x] **Modules per client** (`Client.modules`; `lib/clients/modules.ts`). A module shows in the menu when either:
  - the client turned it on; or
  - **it already has data** (an invoice, a stock count, a fixed asset, a lease, an employee). A module in use never disappears.

  The modules are *Piutang & Utang* (receivables, payables, CKPN), *Persediaan*, *Aset Tetap*, *Sewa (PSAK 116)* and *Imbalan Kerja
  (PSAK 24)*. A trading client (its *Bidang usaha* reads as trading, the same test as the `no-cogs:` control) has Persediaan on by
  default. Pages stay reachable by URL whether or not they're shown.
- [x] **Turning modules on.** A *Modul penyesuaian* card on the client settings page, one switch per module:
  - each switch says what the module does, and that a module with data stays shown (its switch is disabled with *Sudah dipakai*);
  - saving goes through a server action (`getClientForFirm`, any member);
  - the change is written to Riwayat perubahan (`AuditEvent` kind `MODULES`).
- [x] The sidebar reads the modules from the layout in one query per module table for the firm, not one query per client.

**Non-goals:**
- moving or merging pages;
- new page designs;
- the firm close board (next cycle);
- hiding modules from reports and controls (a module's figures still count wherever they belong).

**Gate-reopeners:** **schema migration**, one column `Client.modules text[] default '{}'` (additive, no backfill).

**Assumptions:**
1. Default for existing clients: only modules with data, plus Persediaan for trading clients. Nothing they use disappears.
2. Any member may change which modules show. It is presentation, not books, but it is logged.
3. The stage labels use the ADR's words, with numbers because the order is the order of work.

## Tasks
- [x] T1 Migration + `lib/clients/modules.ts` (catalogue, `visibleModules` for a firm's clients, trading test reused) + DB tests.
  Accept: tests pass.
- [x] T2 Sidebar in three stages, modules filtered; layout passes the visible modules. Accept: lint/typecheck; existing e2e
  names unchanged.
- [x] T3 *Modul penyesuaian* card + `setClientModulesAction` + audit event + DB test. Accept: tests pass.
- [x] T4 Gates (lint, typecheck, test, build, verify:books). Accept: all pass (e2e in CI).

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `prisma/migrations/20261006120000_client_modules` (`Client.modules text[] default '{}'`), `lib/clients/modules.ts` (`MODULES`,
  `clientModules`: one `groupBy` per module table for the whole firm; a trading client gets Persediaan by the `TRADING` words of the
  `no-cogs:` control), `tests/db/client-modules.test.ts`.
- T2: `components/app/app-sidebar.tsx`: the flat `ACCOUNTING` list becomes `stages(modules)`, three micro-labelled stages; the modules
  sit inside Buku Besar before Tutup Buku. `app/(app)/layout.tsx` passes each client's visible modules. Labels and URLs are unchanged.
- T3: `setClientModules` (catalogue order, unknown keys dropped, no-op when unchanged, `AuditEvent` kind `MODULES` *Modul klien*),
  `saveClientModulesAction` (`getClientForFirm`, any member), `components/app/modules-card.tsx` on the client settings page:
  - a module in use is ticked and fixed, labelled *Sudah dipakai*;
  - a trading default is ticked and fixed, labelled *Tampil karena bidang usahanya perdagangan*;
  - checkbox `id` + `label htmlFor`, per ui-rules.
## Verification
- End of cycle: `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 167 passed (167), Tests 1108 passed (1108);
  `npm run build` exit 0; `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- Not seen in a browser here (no Supabase Auth keys in the sandbox). E2e runs in CI, and every sidebar label it clicks is unchanged.
## Ship Notes
- **Migration `20261006120000_client_modules`**: one additive column with a default. No backfill. Existing clients see only the
  modules they use (plus Persediaan when trading).
- The investor demo's clients keep their modules visible wherever they hold data.
- Rollback: revert. The column can stay.

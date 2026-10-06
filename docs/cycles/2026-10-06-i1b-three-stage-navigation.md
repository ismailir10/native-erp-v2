# I1b — Three-stage navigation, modules per client

## Context
ADR 0014 restructures each client around **Sumber → Buku Besar → Laporan**. Today the client menu is one flat list of 14 pages
(`components/app/app-sidebar.tsx`, `ACCOUNTING`). It puts the PSAK and subledger modules (Piutang & Utang, Persediaan, Aset Tetap,
Sewa, Imbalan Kerja) next to the daily close steps for every client, including those that will never use them. That breaks "don't
make me think" for a firm closing 30 small clients.

The owner approved the defaults (ADR 0014 §6: PSAK modules become per-client toggles) and asked to work through the plan ("get them
done", 2026-10-06). The pages stay where they are. Only the way in changes.

## Spec
- [ ] **The client menu shows three stages**, each with a micro-label, in working order:
  - **1 · Sumber:** Impor Mutasi, Saldo Awal.
  - **2 · Buku Besar:** Review transaksi, Buku Besar, Neraca Saldo, Jurnal Penyesuaian, the client's modules, Tutup Buku.
  - **3 · Laporan:** Laporan Keuangan, Pajak Badan.

  The first-run order (Impor → Saldo Awal → Review → Tutup buku, ui-rules 14) reads top to bottom, and nothing in it is collapsed.
  Ringkasan klien stays first, and *Pengaturan klien* (Kurs, Aturan klasifikasi, Riwayat perubahan) stays collapsible. Every label
  and URL is unchanged, so links, bookmarks and e2e keep working.
- [ ] **Modules per client** (`Client.modules`; `lib/clients/modules.ts`). A module shows in the menu when either:
  - the client turned it on; or
  - **it already has data** (an invoice, a stock count, a fixed asset, a lease, an employee). A module in use never disappears.

  The modules are *Piutang & Utang* (receivables, payables, CKPN), *Persediaan*, *Aset Tetap*, *Sewa (PSAK 116)* and *Imbalan Kerja
  (PSAK 24)*. A trading client (its *Bidang usaha* reads as trading, the same test as the `no-cogs:` control) has Persediaan on by
  default. Pages stay reachable by URL whether or not they're shown.
- [ ] **Turning modules on.** A *Modul penyesuaian* card on the client settings page, one switch per module:
  - each switch says what the module does, and that a module with data stays shown (its switch is disabled with *Sudah dipakai*);
  - saving goes through a server action (`getClientForFirm`, any member);
  - the change is written to Riwayat perubahan (`AuditEvent` kind `MODULES`).
- [ ] The sidebar reads the modules from the layout in one query per module table for the firm, not one query per client.

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
- [ ] T1 Migration + `lib/clients/modules.ts` (catalogue, `visibleModules` for a firm's clients, trading test reused) + DB tests.
  Accept: tests pass.
- [ ] T2 Sidebar in three stages, modules filtered; layout passes the visible modules. Accept: lint/typecheck; existing e2e
  names unchanged.
- [ ] T3 *Modul penyesuaian* card + `setClientModulesAction` + audit event + DB test. Accept: tests pass.
- [ ] T4 Gates (lint, typecheck, test, build, verify:books). Accept: all pass (e2e in CI).

## Implementation
## Verification
## Ship Notes

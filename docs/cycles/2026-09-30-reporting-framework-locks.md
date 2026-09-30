# Reporting framework per entity + period-lock ordering (Cycle 2a)

## Context
An Indonesian-accounting advisor reviewed the report set and found two gaps (each verified in code):

1. **The CALK and the Pernyataan Direksi always say "SAK EP"** (`lib/reports/notes.ts`, basis paragraph and directors' statement) while the
   same notes apply full-PSAK wording — PSAK 116 right-of-use for leases, a PSAK 109 expected-loss provision matrix for receivables and
   PSAK 46 deferred tax — and the statement is signed by "Direktur" whatever the entity type (a CV or an individual has no Direksi).
   A micro/small business (SAK EMKM) gets a report set that claims the wrong framework and mentions concepts EMKM does not have.
2. **Period locks have no order and unlock has no accountability** (`lockPeriod` in `lib/controls/index.ts`, `unlockAction` in `app/actions.ts`):
   a month can be locked while an earlier month with data is still open, a month can be reopened under a locked later month, any member
   can reopen, without a reason and without a trace.

Who feels it: the accountant who hands a CALK to a client (wrong framework named), and the partner reviewing closes (locks can be
undone silently). Outcome: each entity carries its reporting framework and the notes/statement names follow it; locks are ordered and
every reopen is admin-only, reasoned and logged.

## Spec
- [ ] `Entity.reportingFramework` enum `SAK_EMKM | SAK_EP | SAK_UMUM`; migration adds it **NOT NULL DEFAULT 'SAK_EP'** so every existing entity keeps today's output byte for byte.
- [ ] *Tambah klien* form has a "Kerangka pelaporan" selector per entity with Bahasa help text (EMKM: usaha mikro/kecil, tanpa pajak tangguhan, aset hak guna, penghasilan komprehensif lain; EP: entitas privat tanpa akuntabilitas publik; Umum: PSAK penuh); server validates it.
- [ ] The client's settings page (`/clients/[id]/settings`) has a *Kerangka pelaporan* card, one selector per entity, saved by a server action (any member; it changes wording only).
- [ ] CALK basis paragraph and the directors' statement name the actual framework (EMKM: SAK EMKM; EP: unchanged text; Umum: SAK yang berlaku umum / PSAK).
- [ ] `SAK_EMKM`: no PSAK 109 expected-loss / forward-looking wording, no right-of-use / lease-liability wording, no deferred-tax policy or estimate row, no "penghasilan komprehensif lain" wording; statements are named *Laporan Posisi Keuangan*, *Laporan Laba Rugi*, *CALK*; a note says cash-flow and changes-in-equity statements are not required by SAK EMKM (kept as supplementary information).
- [ ] Signatory: `PT` and `BADAN_USAHA_ASING` → "Direksi"/"Direktur"; `CV` and `PERORANGAN` → "Pemilik/Pengurus" (statement title, sheet name, signature line).
- [ ] No computed number changes: only wording, titles and gating of estimate rows that are not on any statement. Report page and Excel export read the same source (`lib/reports/framework.ts`), so they cannot disagree.
- [ ] Lock ordering: refuse to lock a month while an earlier month with (non-Saldo-Awal) entries is still open; refuse to unlock a month while a later month is locked. Messages in Bahasa naming the month.
- [ ] Unlock is `ADMIN` only, needs a non-empty reason (≥ 5 chars, as ack notes), and writes a `PeriodUnlockLog` row (client, period, member, reason, time) in the same transaction as the status change.
- [ ] Close page: the unlock dialog has a required reason field (admin only sees the reopen button), and the last unlocks are listed.
- [ ] Tests first: unit (framework × entity kind wording), DB (notes per framework, lock order, unlock role / reason / audit row, delete-client removes logs).
- [ ] README + `accounting-rules` skill updated (short). E2E investor demo untouched and green.

**Non-goals:** changing any number, chart of accounts, tax computation or control; re-basing EP wording (EP keeps its current text, see Assumptions); changing which statements exist in the Excel (EMKM keeps all six sheets); role model changes beyond unlock; AI usage; any change to AI settings / `AppSetting`.

**Gate-reopeners flagged:** schema migration (2 additive objects: enum + column, one new table). No new dependency, no AI credit.

**Assumptions:**
1. Existing rows and the form default are **SAK_EP** (the user can change it); EP output stays identical to today, so the EP-with-PSAK-wording inconsistency the advisor noted is left as the entity's explicit PSAK references (the policy paragraphs already cite PSAK 109/116/PP 35). Moving an entity to SAK_UMUM changes only the basis/statement wording.
2. A multi-entity (Gabungan) scope uses the most demanding framework present (UMUM > EP > EMKM) and "Direksi" when it contains at least one PT / foreign company, otherwise "Pemilik/Pengurus".
3. "Earlier month with data" = an earlier period of the same client, not locked, holding at least one journal entry that is not `OPENING` (a month that only carries the Saldo Awal must not block locking). Unlock ordering = any later period of the client is `LOCKED`.
4. Reopen reason min length 5 characters (same as control notes).
5. Locks stay per client, not per entity (unchanged); the unlock log is per client + period.
6. EMKM keeps the Perubahan Ekuitas and Arus Kas sheets/tabs as supplementary information (the numbers are the ledger's, only the caption says they are optional).

## Tasks
- [x] T1 Schema + migration + `lib/reports/framework.ts` (labels, help, scope resolution, signatory) — accept: unit tests for framework x kind helper pass; migration applies to a DB with existing entities and they read `SAK_EP`.
- [x] T2 Notes, directors' statement, workbook and report titles follow the framework — accept: DB tests for 3 frameworks x kinds; default entity output identical to before (existing statement tests unchanged).
- [x] T3 Tambah klien selector + settings-page card + `saveReportingFrameworkAction` — accept: onboarding test creates entities with framework; action test updates it and rejects an unknown value.
- [x] T4 Lock ordering + admin-only reasoned unlock + `PeriodUnlockLog` (migration, delete-client) — accept: DB tests for order both ways, role, reason, audit row.
- [x] T5 Close UI: reason field + last unlocks — accept: manual screenshot; e2e lock flow unchanged and green.
- [ ] T6 Docs (README, accounting-rules) + end-of-cycle gates — accept: gates recorded below.

## Implementation
- Plan: tasks T1–T6 sequential, done inline (small, tightly coupled slices, one driver).
- T1: `prisma/schema.prisma`, `prisma/migrations/20260930030000_reporting_framework`, `lib/reports/framework.ts`, `tests/unit/framework.test.ts` — enum + NOT NULL DEFAULT 'SAK_EP' column; helpers for standard / statement names / group framework / signatory.
- T2: `lib/reports/notes.ts`, `lib/reports/workbook.ts`, `lib/reports/framework.ts`, `app/(app)/clients/[id]/reports/page.tsx`, `tests/db/framework-notes.test.ts`, `tests/unit/directors-statement.test.ts` — basis paragraph, policies, receivable/lease/OCI notes, deferred-tax estimate row and signatory follow the framework; workbook names/sheet follow it; the report page titles and OCI section follow it. The one row dropped for EMKM ("Estimasi pajak tangguhan belum dicatat") is an estimate on no statement; every statement figure is unchanged (tested).
- T3: `lib/onboarding.ts`, `lib/setup.ts`, `lib/entity-settings.ts`, `app/actions.ts` (`saveReportingFrameworkAction`), `components/app/client-form.tsx`, `components/app/framework-card.tsx`, `app/(app)/clients/[id]/settings/page.tsx`, tests `onboarding`, `entity-framework` — selector on Tambah klien (default SAK EP, validated) and a Kerangka pelaporan card per entity on the client settings page.
- T4+T5 (one commit: the `unlockAction` signature change forces the panel to change with it): `prisma/schema.prisma`, migration `20260930040000_period_unlock_log`, `lib/controls/index.ts` (`earlierOpenMonth`, `laterLockedMonth`, `unlockPeriod`, order checks in `lockPeriod` before the controls and again under the client lock), `app/actions.ts` (`unlockAction(clientId, year, month, reason)`), `lib/clients/delete.ts`, `components/app/close-panel.tsx`, `app/(app)/clients/[id]/close/page.tsx`, `e2e/investor-demo.spec.ts`, tests `period-lock`, `anomaly-controls` (earlier months closed first) — ordered lock/unlock, ADMIN-only + reason + `PeriodUnlockLog`; the close page shows a blocker/NextStep when an earlier month is open, the reason field in the reopen dialog, who may reopen, and the last 5 reopenings; the investor e2e reopens with a reason and closes again.

## Verification
- T1: `npm run lint` clean; `npm run typecheck` clean; `npm test` → `Test Files  95 passed (95)  Tests  639 passed (639)`.

## Ship Notes

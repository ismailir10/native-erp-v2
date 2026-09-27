# Adjustment proposals — depreciation, amortisation and accruals the close proposes

## Context
Bank data gives cash basis; month-end needs accruals. Today every adjusting entry is typed by hand on *Jurnal Penyesuaian*
(one "Penyusutan" template with blank amounts), so the same depreciation is re-typed every month, a prepaid rent is either
expensed at once or forgotten, and a recurring cost whose invoice hasn't arrived simply misses the month. The close has a
sign-off "Jurnal penyesuaian (penyusutan, akrual) sudah dicatat" but nothing that knows which ones are due. The demo shows
the problem: the investor walk types Rp 9.500.000 depreciation by hand, and after cycle C2 the close flags the Rp 166,7 jt
machine bought in August as new fixed-asset movement, with nowhere to say "depreciate this from September".

ADR 0009 already set the rule: proposed entries are drafts the accountant accepts; posting stays in `postJournal()`.
Outcome (Rillet-style): an **adjustment schedule** per recurring item. The close proposes each month's installment and the
accountant posts it with one click. Candidates for new schedules come deterministically from the ledger (a fixed-asset
purchase, a prepayment, a recurring cost missing this month). No AI in this cycle.

## Spec
Schedules (`lib/adjust/schedules.ts`, new)
- [x] **`AdjustmentSchedule`** per entity: kind `DEPRECIATION | AMORTIZATION | ACCRUAL`, memo, debit account, credit account
      (client COA), total amount (bigint minor units, functional currency), `months` (≥ 1), start year/month, `reverse`
      (ACCRUAL), optional `sourceEntryId` (the purchase / prepayment entry it came from), `stoppedAt`, created by.
- [x] **Installments are exact:** k = 1…months, amount = ⌊total / months⌋, the last takes the remainder (Σ = total). A
      `reverse` schedule adds one reversal installment in the month after the last, sides swapped, dated the 1st.
      Installments post on the period's last day.
- [x] **Proposals at read time** (like FX revaluation): for a period, every non-stopped schedule's installment that falls
      in that month and isn't posted yet. Nothing is stored until the click.
- [x] **Post = one click** → `postJournal()` (kind `ADJUSTMENT`, memo `<memo> (k/n)`), with `JournalEntry.scheduleId` +
      `installment`; a DB unique on `(scheduleId, installment)` makes a double click or two tabs post once. Locked periods
      reject it as every write does. **Post all due** for a period in one action (one entry per installment).
- [x] **Stop** a schedule (asset sold, contract ended): later installments are no longer proposed; posted ones stay
      (corrections = new entries). A schedule can't be edited after its first posting — stop it and create a new one.

Candidates from the ledger (deterministic, shown, never created on their own)
- [x] **Fixed-asset purchase:** a debit this period on an `ASET_TETAP` account (not an opening entry, not already a
      schedule's source) → *Jadwal penyusutan*: Dr 6180 / Cr 1219, amount = the line's debit, start next month,
      48 months (editable; straight line).
- [x] **Prepayment / deferred revenue:** a debit on `BIAYA_DIBAYAR_DIMUKA` → *Amortisasi*: Dr (accountant picks the
      expense) / Cr that account, 12 months from next month; a credit on 2160 Pendapatan Diterima di Muka → Dr 2160 / Cr 4110,
      12 months.
- [x] **Recurring cost missing this month:** a BEBAN account with movement in each of the 3 baseline months and none this
      month (reuse `scanLedger` series from C2) → *Akrual*: Dr that account / Cr 2150 Beban Masih Harus Dibayar, amount =
      baseline average (editable), reversed next month.
- [x] Amounts ≥ the C2 materiality when the entity has a baseline (any amount otherwise); 7190/7200, bank, suspense, clearing, intercompany never; a candidate disappears once a
      schedule cites its source entry (accruals: once an ACCRUAL schedule exists for that account and month).

Where it shows
- [x] **Jurnal Penyesuaian** page: *Usulan bulan ini* (due installments, Catat / Catat semua), *Kandidat dari buku besar*
      (Buat jadwal → form prefilled), *Jadwal* (list with progress k/n, remaining amount, Hentikan) and a *Buat jadwal* form
      next to the existing free-form journal. Typed amounts parsed with `parseMoney` in the entity's currency.
- [x] **Tutup Buku:** a card *Usulan jurnal penyesuaian* with the same due list and Catat, and a control
      `sched:<entity>` **REVIEW** "Jurnal terjadwal belum dicatat" while an installment of the period is unposted
      (acknowledgeable like any REVIEW; PASS row not added when an entity has no schedules).
- [x] Every schedule entry keeps `scheduleId` and shows *Jadwal: <memo> (k/n)* where journals are listed; the schedule links its source entry (rule 15 chain).

Demo + verification
- [x] Demo seed: Grup Ayam's existing depreciation becomes a schedule (Rp 1.140.000.000 over 120 months from Mar 2026 =
      Rp 9.500.000/month); closed months post through it instead of `postDepreciation()`. `verify:books` ALL PASS with the
      same numbers.
- [x] Investor walk step 6: *Usulan bulan ini* shows "Penyusutan aset tetap (6/120) Rp 9.500.000" → **Catat**; the
      machine appears under *Kandidat* → **Buat jadwal** (48 months from September) — then the close's 1210 note from C2
      stays. `e2e/investor-demo.spec.ts` + `docs/demo/investor-demo.md` together.
- [x] `tests/db/schedules.test.ts`: installment math (remainder on last, Σ = total), reversal, proposals per month,
      post once under a double call, locked period refused, stop, the three candidate kinds and their look-alikes
      (opening entry, already scheduled, below materiality), the `sched:` control and the lock.

**Gate-reopeners:** **schema migration** — new table `AdjustmentSchedule` (+ enum `ScheduleKind`), two nullable columns on
`JournalEntry` (`scheduleId`, `installment`) with a unique index. Additive. No dependency, **no AI call**, no invariant
change (posting still only via `postJournal()`, only on the accountant's click; accounting-rules gains a rule for schedules).

**Non-goals:** AI-drafted adjusting entries and "Jelaskan" per control (C3); correcting 1999 / reclass proposals; a full
fixed-asset register (disposal gain/loss, revaluation, fiscal vs commercial groups, declining balance, mid-month
proration); editing a schedule after it has posted; posting on a timer.

**Assumptions:**
1. A schedule is per entity, in its functional currency; no FX schedules.
2. Depreciation starts the month after purchase and is straight line; 48 months (SAK EP / tax Kelompok 1) is only the
   form's default.
3. An accrual is one month and reverses on the 1st of the next month; the accountant edits the amount before creating it.
4. Candidates are period-scoped suggestions, not stored and not dismissible; they never block the close. Only a due,
   unposted installment of an existing schedule raises a REVIEW control.
5. For ledger-fed clients that already book depreciation in their own GL, candidates may repeat what their file already
   has; the accountant simply doesn't create a schedule.

## Tasks
- [x] T1 Schema + migration + `lib/adjust/schedules.ts` (create / installments / proposals / post / post-all / stop) + DB tests — accept: migration applies on a fresh DB; `tests/db/schedules.test.ts` green. Reuse `postJournal`, `periodBounds`, `parseMoney`.
- [x] T2 Candidates from the ledger + tests — accept: three candidate kinds and look-alikes in tests. Depends T1. Reuse `scanLedger` (C2).
- [x] T3 UI + actions: Jurnal Penyesuaian sections, Tutup Buku card + `sched:` control — accept: browser check desktop + 390 px; actions resolve the client via `getClientForFirm`. Depends T1–T2. Load `ui-rules`.
- [x] T4 Demo + walk + docs (accounting-rules rule, ADR 0009 note, README close row) — accept: `demo:reset && verify:books` ALL PASS; investor e2e green. Depends T3. Load `demo-data`.
- [ ] T5 End-of-cycle gates — accept: `build`, `verify:books`, full `test:e2e` green.

## Implementation
- Plan: T1–T5 sequential, inline (each layer builds on the previous: schedules → candidates → UI → demo walk).
- T1: `prisma/schema.prisma` + migration `20260927150000_adjustment_schedules` (enum `ScheduleKind`, table `AdjustmentSchedule`, `JournalEntry.scheduleId` / `installment` with a unique index; CHECKs: amount > 0, 1 ≤ months ≤ 600, start month 1–12, debit ≠ credit account, schedule and installment set together). `lib/ledger/post.ts` — `PostInput` carries `scheduleId` / `installment`. `lib/adjust/schedules.ts` — `installments()` (⌊total/n⌋, remainder on the last; reversal = one swapped installment dated the 1st), `createSchedule()` (entity and accounts of the client, never bank / clearing / 1999, `parseMoney` in the entity's currency, ACCRUAL forced to 1 month + reverse, source entry must be the entity's), `dueProposals()` (running schedules, installment in the month, not yet posted), `postInstallment()` (one `postJournal` ADJUSTMENT, memo `<memo> (k/n)` or `Pembalikan: <memo>`; the unique index turns a second click into "sudah dicatat"), `postAllDue()`, `stopSchedule()`, `listSchedules()` (posted count / amount, remaining, last month). Tests: `tests/db/schedules.test.ts`.
- T2: `lib/adjust/candidates.ts` — `scheduleCandidates()` per entity: the period's non-opening lines on `ASET_TETAP`, `BIAYA_DIBAYAR_DIMUKA` and deferred-revenue liabilities (2160 or a name with *diterima di muka / unearned / deferred revenue*), netted per entry and account, excluding entries that are a schedule's installment or already a schedule's source; ≥ C2 materiality (1 minor unit without a baseline). Fixed asset → DEPRECIATION 6180/1219, 48 months from next month; prepayment → AMORTIZATION (debit left for the accountant) / that account, 12 months; deferred revenue → Dr the liability / Cr 4110, 12 months. Accrual: a BEBAN account (7190/7200 never) with positive movement in all 3 baseline months (C2 `scanLedger` series) and none now → ACCRUAL Dr it / Cr 2150 at the average, unless a running schedule debits it or an accrual already starts this month. Tests: `tests/db/schedule-candidates.test.ts` (three kinds + opening entry / below materiality / already scheduled / < 3 baseline months).
- T3: `app/actions.ts` (`createScheduleAction`, `postInstallmentAction`, `postAllDueAction`, `stopScheduleAction`, each through `getClientForFirm`), `lib/adjust/view.ts` (plain-JSON views: due installments, candidates with a form-ready amount, schedules with progress / span / status / source — the bank description for a reviewed bank line), `components/app/schedule-proposals.tsx` (due list, *Catat* per row, *Catat semua (n)*; wraps on phones), `components/app/schedule-panel.tsx` (*Kandidat dari buku besar* → *Buat jadwal* dialog prefilled; blank *Buat jadwal*; kind presets 6180/1219 · 48 bln, …/1170 · 12, …/2150 · akrual; live "± Rp … per bulan"; *Jadwal penyesuaian* table with Tercatat k/n, Sisa, *Hentikan* with a confirm), `app/(app)/clients/[id]/journals/new/page.tsx` (ScopeBar period, NextStep by state: locked / due / candidates / free form), `app/(app)/clients/[id]/close/page.tsx` (the same due card), `lib/controls/index.ts` (`sched:<entity>` REVIEW "Jurnal terjadwal belum dicatat", detail = the installments, link to Jurnal Penyesuaian for the period). Candidate memo reads "Penyusutan Aset Tetap 19 Agu 2026"; the reason quotes the bank description. Test: the `sched:` control appears for a due installment and clears once posted or stopped.
- T4: `lib/demo/seed.ts` — Grup Ayam's depreciation is an adjustment schedule (Rp 1.140.000.000 over 120 months from March 2026 = Rp 9.500.000/month) created after the openings; closed months post their installment through `postInstallment()` (the old `postDepreciation()` is gone), so August's 6/120 is the live one-click moment. `e2e/investor-demo.spec.ts` step 6: *Catat* on the proposed installment, then *Buat jadwal* on the machine candidate (48 bulan, 2026-09) → "Jadwal dibuat", candidate gone; step 7's 1210 note now matches reality ("Penyusutan mulai September"). `docs/demo/investor-demo.md` §5, `.agents/skills/demo-data/SKILL.md`, accounting-rules **5a**, ADR 0009 note (the first proposed entries are deterministic schedules), README (*Jurnal Penyesuaian* row, close row). Demo inspection: in August every client has no candidate and one due item — Ayam's 6/120.

## Verification
- T1: fresh DB `prisma migrate deploy` → "All migrations have been successfully applied." with the five CHECK constraints present; lint + typecheck clean; `npm test` → Test Files 54 passed (54), Tests 400 passed (400).
- T2: lint + typecheck clean; `npm test` → Test Files 55 passed (55), Tests 404 passed (404).
- T3: lint + typecheck clean; `npm test` → Test Files 55 passed (55), Tests 405 passed (405). Browser (`next start` :3200, local demo DB with an Ayam depreciation schedule and the machine reviewed to 1210): Jurnal Penyesuaian at 1440 px and 390 px (`scrollWidth` 1440 / 390, no horizontal scroll) shows the due installment *Penyusutan aset tetap (garis lurus) (6/120) Rp 9.500.000*, the machine as a candidate (Rp 166.666.667), the schedule list; *Buat jadwal* from the candidate → dialog prefilled (6180/1219, 48 bulan, September, ± Rp 3.472.222 per bulan) → *Simpan jadwal* → toast "Jadwal dibuat", candidate gone; *Catat* → toast "Penyusutan aset tetap (garis lurus) (6/120) dicatat", the entry on top of *Terakhir dicatat*. Tutup Buku shows the same card and the *Jurnal terjadwal belum dicatat* control.
- T4: lint + typecheck clean; `npm test` → Test Files 55 passed (55), Tests 405 passed (405); `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth. (same numbers, now through the schedule); `npm run build` ✓; `e2e/investor-demo.spec.ts` → 2 passed (21.2s).

## Ship Notes

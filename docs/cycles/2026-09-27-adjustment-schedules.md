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
- [ ] **`AdjustmentSchedule`** per entity: kind `DEPRECIATION | AMORTIZATION | ACCRUAL`, memo, debit account, credit account
      (client COA), total amount (bigint minor units, functional currency), `months` (≥ 1), start year/month, `reverse`
      (ACCRUAL), optional `sourceEntryId` (the purchase / prepayment entry it came from), `stoppedAt`, created by.
- [ ] **Installments are exact:** k = 1…months, amount = ⌊total / months⌋, the last takes the remainder (Σ = total). A
      `reverse` schedule adds one reversal installment in the month after the last, sides swapped, dated the 1st.
      Installments post on the period's last day.
- [ ] **Proposals at read time** (like FX revaluation): for a period, every non-stopped schedule's installment that falls
      in that month and isn't posted yet. Nothing is stored until the click.
- [ ] **Post = one click** → `postJournal()` (kind `ADJUSTMENT`, memo `<memo> (k/n)`), with `JournalEntry.scheduleId` +
      `installment`; a DB unique on `(scheduleId, installment)` makes a double click or two tabs post once. Locked periods
      reject it as every write does. **Post all due** for a period in one action (one entry per installment).
- [ ] **Stop** a schedule (asset sold, contract ended): later installments are no longer proposed; posted ones stay
      (corrections = new entries). A schedule can't be edited after its first posting — stop it and create a new one.

Candidates from the ledger (deterministic, shown, never created on their own)
- [ ] **Fixed-asset purchase:** a debit this period on an `ASET_TETAP` account (not an opening entry, not already a
      schedule's source) → *Jadwal penyusutan*: Dr 6180 / Cr 1219, amount = the line's debit, start next month,
      48 months (editable; straight line).
- [ ] **Prepayment / deferred revenue:** a debit on `BIAYA_DIBAYAR_DIMUKA` → *Amortisasi*: Dr (accountant picks the
      expense) / Cr that account, 12 months from next month; a credit on 2160 Pendapatan Diterima di Muka → Dr 2160 / Cr 4110,
      12 months.
- [ ] **Recurring cost missing this month:** a BEBAN account with movement in each of the 3 baseline months and none this
      month (reuse `scanLedger` series from C2) → *Akrual*: Dr that account / Cr 2150 Beban Masih Harus Dibayar, amount =
      baseline average (editable), reversed next month.
- [ ] Amounts ≥ the C2 materiality when the entity has a baseline (any amount otherwise); 7190/7200, bank, suspense, clearing, intercompany never; a candidate disappears once a
      schedule cites its source entry (accruals: once an ACCRUAL schedule exists for that account and month).

Where it shows
- [ ] **Jurnal Penyesuaian** page: *Usulan bulan ini* (due installments, Catat / Catat semua), *Kandidat dari buku besar*
      (Buat jadwal → form prefilled), *Jadwal* (list with progress k/n, remaining amount, Hentikan) and a *Buat jadwal* form
      next to the existing free-form journal. Typed amounts parsed with `parseMoney` in the entity's currency.
- [ ] **Tutup Buku:** a card *Usulan jurnal penyesuaian* with the same due list and Catat, and a control
      `sched:<entity>` **REVIEW** "Jurnal terjadwal belum dicatat" while an installment of the period is unposted
      (acknowledgeable like any REVIEW; PASS row not added when an entity has no schedules).
- [ ] Every schedule entry keeps `scheduleId` and shows *Jadwal: <memo> (k/n)* where journals are listed; the schedule links its source entry (rule 15 chain).

Demo + verification
- [ ] Demo seed: Grup Ayam's existing depreciation becomes a schedule (Rp 1.140.000.000 over 120 months from Mar 2026 =
      Rp 9.500.000/month); closed months post through it instead of `postDepreciation()`. `verify:books` ALL PASS with the
      same numbers.
- [ ] Investor walk step 6: *Usulan bulan ini* shows "Penyusutan aset tetap (6/120) Rp 9.500.000" → **Catat**; the
      machine appears under *Kandidat* → **Buat jadwal** (48 months from September) — then the close's 1210 note from C2
      stays. `e2e/investor-demo.spec.ts` + `docs/demo/investor-demo.md` together.
- [ ] `tests/db/schedules.test.ts`: installment math (remainder on last, Σ = total), reversal, proposals per month,
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
- [ ] T1 Schema + migration + `lib/adjust/schedules.ts` (create / installments / proposals / post / post-all / stop) + DB tests — accept: migration applies on a fresh DB; `tests/db/schedules.test.ts` green. Reuse `postJournal`, `periodBounds`, `parseMoney`.
- [ ] T2 Candidates from the ledger + tests — accept: three candidate kinds and look-alikes in tests. Depends T1. Reuse `scanLedger` (C2).
- [ ] T3 UI + actions: Jurnal Penyesuaian sections, Tutup Buku card + `sched:` control — accept: browser check desktop + 390 px; actions resolve the client via `getClientForFirm`. Depends T1–T2. Load `ui-rules`.
- [ ] T4 Demo + walk + docs (accounting-rules rule, ADR 0009 note, README close row) — accept: `demo:reset && verify:books` ALL PASS; investor e2e green. Depends T3. Load `demo-data`.
- [ ] T5 End-of-cycle gates — accept: `build`, `verify:books`, full `test:e2e` green.

## Implementation

## Verification

## Ship Notes

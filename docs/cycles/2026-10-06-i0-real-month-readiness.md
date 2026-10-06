# I0 — Real-month readiness

## Context
The owner approved the iteration plan in `docs/cycles/2026-10-06-plan-deck.md` ("okay please proceed", 2026-10-06). Its defaults stand:
- the buyer is the accounting firm;
- PSAK modules become per-client toggles in I1;
- no new modules until I2.

I0 is one real client, one real month, one accountant, timed end to end. The failures of that month write the scope of I1 and I2.
Code alone can't run that month: a person must close it. This cycle gets Buku ready for it in four ways:

1. **Record the plan as a decision.** ADR 0014 records the three-stage spine (Sumber → Buku Besar → Laporan), the AI pattern
   ("AI mengusulkan, aritmetika membuktikan, akuntan menyetujui") and the iteration order. The plan deck leaves the public path:
   everything under `public/deck` is served without login once `main` deploys.
2. **Stop wrong numbers at the database.** QA (2 Oct, §6) found that balance and period lock are enforced only in `postJournal`;
   the database has no triggers for either. A bug or a script that writes around `postJournal` today leaves an unbalanced entry or
   changes a locked month without a trace. Database triggers make those writes impossible.
3. **Stop guessing dates.** QA E17: a US-format file (`02/13/2026`) is read silently as day/month. In a file where every value is
   ≤ 12 on both sides, months are swapped with no warning, and a real client's admin Excel is exactly where that happens.
4. **Measure the month.** The north-star metric is the time from client files received to a pack ready to send. Buku records
   imports, reviews and the lock, but not when a report leaves. A report export becomes an audit event, and a script prints each
   client-month's timeline.

## Spec
- [x] **ADR 0014 "Tiga tahap"** (`docs/adrs/0014-three-stage-spine.md`):
  - the thesis, the spine and the AI pattern;
  - the I0–I5 order;
  - what is deliberately not done (export back to Accurate/Jurnal, marketplace settlements, live bank feeds, becoming a PJAP,
    new PSAK modules until I2);
  - the defaults the owner approved;
  - links to the plan deck.
  ADR 0004's stale out-of-MVP list gets an amendment note pointing to 0014.
- [x] **Plan deck moves out of `public/`** into `docs/plan/2026-10-rencana-iterasi.html`, self-contained (CSS, JS and font inlined), so
  it opens from the repo without a server. `public/deck/rencana.*` is removed, and the public `/deck` is unchanged.
- [ ] **Database guards for the ledger.** One migration adds triggers. Each refusal names the rule in its message.
  - **Balanced.** A deferred constraint trigger on `JournalLine` refuses, at commit, any entry whose lines don't sum
    Σdebit = Σcredit or that has fewer than 2 lines. Deleting a whole entry passes.
  - **Locked period.** Inserting or deleting a `JournalEntry` / `JournalLine` dated in a `LOCKED` month of its client is refused.
    The one bypass is the client-delete path, through a transaction-local setting (`SET LOCAL buku.client_delete = 'on'`) that
    `lib/clients/delete.ts` sets.
  - **Immutable.** Updating a line's `debit`, `credit`, `accountId`, `entityId`, `date` or `entryId` is refused. So is updating an
    entry's `entityId`, `periodId`, `date` or `kind`. Other columns (for example a foreign key set to null when a member is
    removed, or `reversesId` cleared during client delete) still change.
  - **Period matches date.** An entry's `periodId` must be the period of its own date's year and month.
- [ ] **Ambiguous dates are decided per file, never per row** (`lib/import/parsers/common.ts` → used by the tabular parser and the
  ledger reader). A file's numeric `a/b/yyyy` dates are read as follows:
  - **day/month** when any value has a > 12 first;
  - **month/day** when any value has a > 12 second and none a > 12 first. The import shows the note *Tanggal dibaca sebagai
    bulan/hari (format AS)*;
  - **refused** with a Bahasa `ParseError` naming two example cells when both kinds occur;
  - **all values ≤ 12 on both sides:**
    - a bank statement takes the order whose dates run in order, preferring day/month;
    - when neither order is chronological, the file is refused with a message to check the date format;
    - a ledger file stays day/month and gets an INFO check *Format tanggal tidak bisa dipastikan* citing the column.
  PDF parsing and dates with month names are unchanged.
- [ ] **Close timeline.**
  - Report exports (Laporan Excel, PDF, Pajak kertas kerja) write an `AuditEvent` of kind `REPORT_EXPORT` (subject
    `period:YYYY-MM`, summary = which file).
  - `npm run close:timeline -- --client <id|name> [--period YYYY-MM]` prints, per month:
    - first and last file in (statement and ledger imports);
    - last review action;
    - locked at;
    - first export after the lock;
    - the elapsed time from first file in to that export.
  - The script is read-only and is not part of the UI.
- [ ] **Real-month runbook** `docs/real-month.md`:
  - picking the client;
  - what to collect (the ugliest file set);
  - the UU PDP stance (AI off unless the firm decides otherwise; the key and the AI switch live in Pengaturan);
  - running the month;
  - recording each blocker with time lost;
  - reading the timeline;
  - how results feed I1 and I2.
- [ ] `accounting-rules` rules 2–4 name the database guards. README "What it does" mentions none of this (no user-facing change).

**Non-goals:**
- the per-client module toggles and the new navigation (I1);
- OCR;
- new banks;
- any change to how a valid file is parsed;
- showing the timeline in the app;
- the 20-digit amount crash (QA E18, a visible error and not a silent number; noted for I1).

**Gate-reopeners:**
- **schema migration** (triggers and functions only, no table change);
- **accounting invariants strengthened** (rules 2–4 also held by the database).

There is no new dependency and no AI credit use.

**Assumptions:**
1. "Proceed" approves the plan with its recommended defaults: the buyer is the accounting firm, PSAK modules become toggles in I1,
   and new modules are frozen until I2.
2. Choosing the real client and accountant, and the UU PDP decision, stay with the owner. This cycle ships the runbook and defaults
   to AI off for the real month.
3. Existing data already satisfies the guards because `postJournal` enforces the same rules. The migration checks this first and
   fails with the offending entry ids instead of half-applying. Production gets the same pre-check.
4. Trigger refusals surface through the existing error path. Normal use never reaches them because `postJournal` refuses first, so
   no new Bahasa UI copy is needed.
5. The I3 slide in the plan deck overstated the gap. *Defisiensi modal* (`going-concern:`) and *HPP nol* (`no-cogs:`) controls already
   exist (accounting-rules 22a). The ADR words I3 as "kontrol tambahan dari bulan nyata", not those two.

## Tasks
- [x] T1 ADR 0014 + ADR 0004 amendment note + plan deck moved to `docs/plan/` (self-contained), `public/deck/rencana.*` removed.
  Accept: `/deck` files unchanged; `docs/plan/…html` opens offline with no external requests.
- [ ] T2 Ledger guards migration + `SET LOCAL` in client delete + DB tests (`tests/db/ledger-guards.test.ts`):
  - unbalanced raw insert refused at commit;
  - single-line entry refused;
  - insert, delete and amount update in a locked month refused;
  - date/period mismatch refused;
  - deleting a client with a locked month still works;
  - removing an import in an open month still works;
  - normal `postJournal` paths untouched.
  Accept: the new tests and the full `npm test` pass.
- [ ] T3 Date order per file (reuse `dateParts`; a new `detectDayMonthOrder` in `common.ts`), wired into `tabular.ts` and
  `ledger-import/read.ts` + `check.ts` (INFO). Unit tests:
  - a US CSV;
  - a mixed file refused;
  - an all-ambiguous file decided by chronology;
  - an Indonesian file unchanged;
  - a ledger INFO.
  Accept: tests pass and `verify:books` is ALL PASS (demo files unaffected).
- [ ] T4 `REPORT_EXPORT` audit events on the three export routes + `scripts/close-timeline.ts` + `npm run close:timeline`.
  DB test of the timeline on a seeded client. Accept: the script prints the demo firm's locked months with elapsed times.
- [ ] T5 `docs/real-month.md` runbook + accounting-rules update. Accept: the end-of-cycle gates (`lint`, `typecheck`, `test`,
  `build`, `verify:books`, `test:e2e`) pass.

## Implementation
- Plan: tasks T1–T5 sequential, done inline (small, each depends on the gates of the one before; T2 and T3 touch the ledger and import invariants, so no delegation).
- T1: `docs/adrs/0014-three-stage-spine.md`, ADR 0004 amendment, ADR index; `docs/plan/2026-10-rencana-iterasi.html` (deck.css + rencana.css + deck.js + Inter inlined); `public/deck/rencana.{html,css}` removed — the ADR records the plan, the deck leaves the public path.
## Verification
- T1 gate: lint + typecheck clean; `npm test` → Test Files 162 passed (162), Tests 1070 passed (1070). `docs/plan/2026-10-rencana-iterasi.html` opened as `file://` in Chromium: 17 slides, 0 external requests, 0 page errors, Inter loaded from the inlined font. `git diff main -- public/deck` is empty: the public deck is exactly main's.
## Ship Notes

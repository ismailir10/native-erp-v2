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
- [x] **Database guards for the ledger.** One migration adds triggers. Each refusal names the rule in its message.
  - **Balanced.** A deferred constraint trigger on `JournalLine` refuses, at commit, any entry whose lines don't sum
    Σdebit = Σcredit or that has fewer than 2 lines. Deleting a whole entry passes.
  - **Locked period.** Inserting or deleting a `JournalEntry` / `JournalLine` dated in a `LOCKED` month of its client is refused.
    The one bypass is the client-delete path, through a transaction-local setting (`SET LOCAL buku.client_delete = 'on'`) that
    `lib/clients/delete.ts` sets.
  - **Immutable.** Updating a line's `debit`, `credit`, `accountId`, `entityId`, `date` or `entryId` is refused. So is updating an
    entry's `entityId`, `periodId`, `date` or `kind`. Other columns (for example a foreign key set to null when a member is
    removed, or `reversesId` cleared during client delete) still change.
  - **Period matches date.** An entry's `periodId` must be the period of its own date's year and month.
- [x] **Ambiguous dates are decided per file, never per row** (`lib/import/parsers/common.ts` → used by the tabular parser and the
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
- [x] **Close timeline.**
  - Report exports (Laporan Excel, PDF, Pajak kertas kerja) write an `AuditEvent` of kind `REPORT_EXPORT` (subject
    `period:YYYY-MM`, summary = which file).
  - `npm run close:timeline -- --client <id|name> [--period YYYY-MM]` prints, per month:
    - first and last file in (statement and ledger imports);
    - last review action;
    - locked at;
    - first export after the lock;
    - the elapsed time from first file in to that export.
  - The script is read-only and is not part of the UI.
- [x] **Real-month runbook** `docs/real-month.md`:
  - picking the client;
  - what to collect (the ugliest file set);
  - the UU PDP stance (AI off unless the firm decides otherwise; the key and the AI switch live in Pengaturan);
  - running the month;
  - recording each blocker with time lost;
  - reading the timeline;
  - how results feed I1 and I2.
- [x] `accounting-rules` rules 2–4 name the database guards. README "What it does" mentions none of this (no user-facing change).

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
- [x] T2 Ledger guards migration + `SET LOCAL` in client delete + DB tests (`tests/db/ledger-guards.test.ts`):
  - unbalanced raw insert refused at commit;
  - single-line entry refused;
  - insert, delete and amount update in a locked month refused;
  - date/period mismatch refused;
  - deleting a client with a locked month still works;
  - removing an import in an open month still works;
  - normal `postJournal` paths untouched.
  Accept: the new tests and the full `npm test` pass.
- [x] T3 Date order per file (reuse `dateParts`; a new `detectDayMonthOrder` in `common.ts`), wired into `tabular.ts` and
  `ledger-import/read.ts` + `check.ts` (INFO). Unit tests:
  - a US CSV;
  - a mixed file refused;
  - an all-ambiguous file decided by chronology;
  - an Indonesian file unchanged;
  - a ledger INFO.
  Accept: tests pass and `verify:books` is ALL PASS (demo files unaffected).
- [x] T4 `REPORT_EXPORT` audit events on the three export routes + `scripts/close-timeline.ts` + `npm run close:timeline`.
  DB test of the timeline on a seeded client. Accept: the script prints the demo firm's locked months with elapsed times.
- [x] T5 `docs/real-month.md` runbook + accounting-rules update. Accept: the end-of-cycle gates (`lint`, `typecheck`, `test`,
  `build`, `verify:books`, `test:e2e`) pass.

## Implementation
- Plan: tasks T1–T5 sequential, done inline (small, each depends on the gates of the one before; T2 and T3 touch the ledger and import invariants, so no delegation).
- T1: `docs/adrs/0014-three-stage-spine.md`, ADR 0004 amendment, ADR index; `docs/plan/2026-10-rencana-iterasi.html` (deck.css + rencana.css + deck.js + Inter inlined); `public/deck/rencana.{html,css}` removed — the ADR records the plan, the deck leaves the public path.- T2: `prisma/migrations/20261006090000_ledger_guards/migration.sql`, `prisma/schema.prisma` (`@@index([entryId])`), `lib/clients/delete.ts`,
  `tests/db/ledger-guards.test.ts` — the migration first checks existing data (unbalanced/single-line entries, entries filed under another
  period, lines off their entry) and raises with up to 20 ids instead of half-applying. Then it adds:
  - deferred constraint triggers (balanced at commit, on line and entry);
  - `BEFORE` guards on entry and line (own-month period, locked month, immutable core columns);
  - a transaction-local bypass `buku.client_delete` that only `deleteClient` sets.
  **Spec deviation (small):** an index on `JournalLine.entryId`. The balance check reads an entry's lines per changed row, and without
  the index that read is a full scan per line, which is quadratic on a large ledger import. The foreign key never had an index
  (entry deletes cascaded by scanning too). No table or column changes.
- T3: `lib/import/parsers/common.ts` (`DayMonthOrder`, `dayMonthEvidence`, `chronologicalOrder`, `dateParts({ order })`),
  `lib/import/parsers/tabular.ts` (decides the order once from the date column, before any row is read), `lib/ledger-import/{read,check,post,types}.ts`
  (`cellDate(c, order)`, `ReadResult.dateOrder`, checks `DATE_ORDER_US` INFO, `DATE_ORDER_UNSURE` INFO, `DATE_ORDER_MIXED` BLOCK),
  `tests/unit/date-order.test.ts`. Known bank formats (BCA, BRI CSV) and PDFs are unchanged. Two cases worth noting:
  - Before this change a US date with a day > 12 already failed loudly. The silent case was a file where every value is ≤ 12.
  - **Spec deviation (small):** a bank file whose all-ambiguous dates run in time in *neither* order is read day/month with a note
    (*Format tanggal tidak bisa dipastikan…*) instead of being refused. Internet banking exports sometimes put a few rows out of order,
    and refusing a file that imports today would be a regression. The note keeps it from being silent.
- T4: `lib/reports/export-log.ts` (`recordExport`: one `REPORT_EXPORT` event per download, subject `period:YYYY-MM`, summary
  file · scope · month · final/draf; a logging failure never blocks the download), the three export routes, `lib/audit.ts` (kind +
  label *Laporan diunduh*, so the event also shows in Riwayat perubahan), `lib/controls/timeline.ts` (`closeTimeline`, `formatDuration`;
  read-only), `scripts/close-timeline.ts` + `npm run close:timeline`, `tests/db/close-timeline.test.ts`. A draft downloaded before the
  lock is logged but doesn't count as *terkirim*; a review counts for the month of the bank line it changed.
- T5: `docs/real-month.md` (picking the client and the ugliest file set, AI off by default, a blocker log by stage, reading
  `close:timeline`, turning minutes lost into I1–I4 scope), `.agents/skills/accounting-rules/SKILL.md` (rules 2, 3 and 4 name the
  database guards; new 16a on per-file date order).

## Verification
- T1 gate: lint + typecheck clean; `npm test` → Test Files 162 passed (162), Tests 1070 passed (1070). `docs/plan/2026-10-rencana-iterasi.html` opened as `file://` in Chromium: 17 slides, 0 external requests, 0 page errors, Inter loaded from the inlined font. `git diff main -- public/deck` is empty: the public deck is exactly main's.
- T2 gate: lint + typecheck clean; `tests/db/ledger-guards.test.ts` 11 passed; `npm test` → Test Files 163 passed (163), Tests 1081 passed (1081).
  `npm run demo:reset` through the triggers, then `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T3 gate: lint + typecheck clean; `tests/unit/date-order.test.ts` 12 passed; `npm test` → Test Files 164 passed (164), Tests 1093 passed (1093).
  `npm run demo:reset` + `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T4 gate: lint + typecheck clean; `tests/db/close-timeline.test.ts` 5 passed; `npm test` → Test Files 165 passed (165), Tests 1098 passed (1098).
  `npm run close:timeline` on the demo firm prints each client's months (Maret–Juli locked, Agustus open; seeded in one run, so
  *file → kunci* reads 0 menit and *terkirim* is "—" until a report is downloaded after a lock).
- End of cycle:
  - `npm run lint`: exit 0. `npm run typecheck`: exit 0.
  - `npm test`: Test Files 165 passed (165), Tests 1098 passed (1098).
  - `npm run build`: exit 0.
  - `npm run demo:reset` + `npm run verify:books`: `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
  - **Not run here: `npm run test:e2e`.** Its global setup stops with "SUPABASE_SECRET_KEY belum diatur": this sandbox has no
    Supabase Auth keys. CI runs the e2e walk against its own local Supabase stack (`.github/workflows/ci.yml`).
  - Sandbox note: `npm ci` can't fetch `xlsx` from `cdn.sheetjs.com` (blocked by the network policy). Dependencies were installed
    with `xlsx@0.18.5` from npm for local runs only; `package.json` and the lockfile are unchanged, and CI installs the real package.

## Ship Notes
- **Migration `20261006090000_ledger_guards`** runs in `vercel-build.sh` (`prisma migrate deploy`). It changes no table, adds one
  index (`JournalLine_entryId_idx`), and adds the trigger functions and triggers.
- **It checks existing data first.** If production holds an unbalanced or single-line entry, an entry filed under another month,
  or a line off its entry, the migration fails, the deploy stops, and the error lists up to 20 ids. Production's ledger was written
  only by `postJournal`, so none is expected. If one appears: fix that entry (or ask), then redeploy. Don't edit the migration.
- **After deploy:**
  - Deleting a client with a closed month works as before.
  - Removing an import in a closed month was already refused by the app, and is now refused by the database too.
  - A refusal message starting "Buku besar:" means code went around `postJournal`.
- **Rollback** (only if a trigger blocks legitimate work): ship a new migration that runs
  `DROP TRIGGER "JournalLine_guard" ON "JournalLine"; DROP TRIGGER "JournalEntry_guard" ON "JournalEntry"; DROP TRIGGER
  "JournalLine_balanced" ON "JournalLine"; DROP TRIGGER "JournalEntry_balanced" ON "JournalEntry";`. The functions and the index can
  stay. Never edit or delete the applied migration: `_prisma_migrations` keeps its checksum.
- **No env vars.** New command: `npm run close:timeline` (read-only).
- **Report downloads now appear in Riwayat perubahan** as *Laporan diunduh*.
- **Next:**
  - Run the real month per `docs/real-month.md`.
  - The owner chooses the client and the accountant, and decides UU PDP (AI off by default).
  - Its blocker log becomes I1's Context.
  - QA E18 (a 20-digit amount crashing an import) is noted for I1.

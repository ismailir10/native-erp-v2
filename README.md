# Buku

**Buku combines a double-entry general ledger, document evidence, and company context to help accounting firms prepare books, answer financial questions, and close with confidence.**

Bring a client's **rekening koran, existing ledgers, financial statements, company profiles, and supporting documents**.
Buku helps accountants understand the business, review accounting work, and trace results to their sources.

## How Buku works

![Buku product architecture: client information supports a shared foundation of document evidence, a central double-entry general ledger, and company context. Buku intelligence connects this foundation to Ask Buku, the accounting workspace, and reporting and close. Accounting controls, human review, and source traceability span the system.](docs/architecture/buku-architecture.svg)

**One foundation, three ways to work.** Ask questions, prepare and review accounting, or inspect financial reports and close readiness. AI uses company context and source evidence alongside the books; accounting rules govern calculations and posting.

| What you bring | What Buku does with it |
|---|---|
| **Rekening koran** | Reads bank transactions, checks continuity, suggests classifications, and reconciles transactions with the books. |
| **Existing ledgers / neraca saldo** | Checks exported books, maps source accounts, and prepares reviewed imports into Buku's own ledger. |
| **Financial statements** | Reads and compares source-reported figures, even before transaction-level books are available. |
| **Company profiles** | Proposes business context and company/entity information for the accountant to confirm. |
| **Supporting documents** | Preserves searchable evidence and source references for questions and accounting decisions. |

### The general ledger is the accounting core

Buku **imports existing ledgers and maintains its own double-entry general ledger**. Bank transactions, approved ledger imports, and adjustments produce journal entries through the accounting engine. Buku's financial reports are calculated from those posted entries, with reconciliation controls and period locks.

Document evidence remains distinct: an uploaded financial statement records **what that source reports**; it does not automatically create journal entries or become a Buku financial report. Company profiles provide context, not balances. AI proposes classifications, mappings, and explanations; accountants review AI suggestions, while deterministic services calculate amounts and enforce posting rules. Report figures drill through the ledger to their sources; document answers cite the relevant evidence.

Supported evidence formats include text PDFs, XLSX, XLS, CSV, Google Docs/Sheets, TXT, and Markdown. **Support depends on document structure:** scans require a text export, and ambiguous financial layouts remain searchable evidence rather than guessed figures. See [document support and limits](docs/evidence-workspace.md#supported-input-and-limits).

### Current experience and limits

**Available in this implementation:** invitation-only login with email + password (Supabase Auth; admin and akuntan roles), dashboard-level Tanya Buku, shared client/company and period selectors, prioritized work, document evidence and company-context review, financial reports, and controlled month-end close. Production (`main`) is the only hosted environment; a throwaway local Supabase stack backs local development and e2e Auth ([ADR 0015](docs/adrs/0015-production-only.md)).

**Tanya Buku supports bounded read-only questions:** close readiness, posted profit/revenue, cash and account balances, bank transfers to or from a named party in the month (count, totals, accounts they sit on), the transactions still in Review to ask the client about, document search, and company context. Its portfolio answers are calculated with deterministic tools; unsupported questions say so. Answers retain the scope and period at submission, with source links and session-only history. Document-specific AI tools remain available within their existing budget controls; an AI answer plan with harmless slips is normalised, one that names an entity outside the chosen scope is ignored with a note, and Pengaturan shows the 30-day plan-rejection rate. Cross-client views compare companies in their own currencies; they do not consolidate them. Always-on agents and live bank feeds are not implemented.

Review the [standalone, clickable HTML prototype](docs/prototypes/buku-workspace.html) and its [review guide](docs/prototypes/README.md). Download the HTML and open it in a browser, or serve this repository locally. All prototype data, answers, sign-in, and accounting actions are simulated; no production changes or API calls occur.

> Current deployment and real-data boundaries are documented below and in [docs/real-data.md](docs/real-data.md). Development history: [docs/cycles](docs/cycles/).

## What it does
| Area | |
|---|---|
| **Import** | PDF e-statements (text, password-protected, combined multi-account e.g. SMBC), KlikBCA CSV, Mandiri XLSX, BRI CSV, generic column detection for CSV/TSV/XLSX/XLS (old Excel and HTML-as-.xls) · accountants' working copies: one sheet per month joined, year asked when the file has none, debet/kredit direction from the running balance · running-balance continuity check · dedupe on re-upload · a statement from before the account's first one must hand over to it (closing = that statement's opening), else it is refused (wrong year / account) · **Kelengkapan data** opens the import page: bank account (and ledger-file) × month, *ada / bolong / tidak nyambung*, with a ready-to-send request to the client (*Salin pesan* / *Kirim lewat WhatsApp*) listing exactly what is missing · **Tautan unggah klien**: a secret link (7/14/30 days, revocable, shown once) through which the client sends PDF/CSV/XLS/XLSX files without an account to `/kirim/<token>`; they land in a *Kiriman klien* collection in Dokumen for the accountant to read and import — upload only, nothing posts · **Baca scan dengan AI** (workspace switch in Pengaturan, off by default — UU PDP): a scanned PDF or photo is transcribed by the configured vision model, every row is proved by the running balance (previous balance + credit − debit = printed balance), the accountant fixes what does not tie on *Periksa scan*, and the proved rows import through the same pipeline · two-number dates read day/month unless the file proves month/day (US exports, said so); a file mixing both is refused |
| **Ledger / Neraca import** | GL or Neraca from Jurnal/Accurate/Excel (XLSX, XLS, CSV) · source checks with row refs (unbalanced groups, broken cells, reused codes, foreign lines without rate) · each entity keeps its own chart, mapped to Buku's by rules (type from the file's own numbering; a generic match proposes a new Buku account named after the client's) → AI (names only) → accountant · all-or-nothing posting · Neraca sub-headings (current / long-term) steer suggestions · a Neraca printed as two panels side by side (Aset | Kewajiban + Ekuitas, spaced level codes) is read as one · an entity with its own chart opens Buku Besar and Neraca Saldo in *Akun klien*, each with its own ledger down to `sheet!row` |
| **Multi-currency** | functional currency per entity · fx lines with rate · Kurs page (typed-in / from file, never fetched) · month-end revaluation on click · Gabungan translated to IDR (closing / average / historical, CTA line) |
| **Onboarding** | Tambah klien (entities + bank accounts, template COA) → **one guided first-run order**, derived from the books (`lib/setup-progress.ts`): Unggah data → Saldo Awal per entity (bank lines prefilled from the statement; plug to 3200; not required for an entity with no bank account) → Review → Tutup buku. The same next step and a "Langkah n dari 4" strip show on Ringkasan, Impor and Saldo Awal; Beranda lists one task per client still in setup (its full task list is `/?tugas=semua`; `/work` redirects there). A forgotten company/owner or bank account is added later from the client's *Aturan klasifikasi* page (next free GL code 1101–1109 / PRK 2201–2209). A statement whose new rows fall on or before the entity's Saldo Awal is refused (they are already inside the opening) · the client menu runs in three stages, **Sumber → Buku Besar → Laporan**; Piutang & Utang, Persediaan, Aset Tetap, Sewa and Imbalan Kerja show only when the client uses or turned them on (*Modul penyesuaian* in the client settings; trading clients start with Persediaan) |
| **Classify** | transfer matcher (own accounts → 1199, group entities → 1190, within 2 business days) → rules → learned memory → financing text (loans, capital, own-account moves → balance sheet, no AI call) → LLM (cached, capped) → review · tax payments file by their KAP-KJS code (411121 PPh 21 … 411211 PPN) or, uncoded (MPN / DJP / SSP), wait on 2145 for review · Review: search, *Uang masuk / keluar / Tebakan* filters, *Terima N usulan AI yakin*; a simple guess isn't accepted by Enter nor learned unchanged; *Pemotongan PPh* per line grosses up the net bank amount (PPh 23 / 4(2) / 21 / 22, rate editable) · *Pecah transaksi*: a combined transfer split across accounts in Review or Buku Besar, the parts adding up exactly to the line (else refused), each part drilling to the bank row |
| **Ledger** | double entry, BigInt Rupiah, immutable entries, reclass-by-difference, period locks, PPN 11% split · *Balik jurnal*: a manual adjustment is reversed from its ledger line on a chosen date, once · the database refuses what the journal writer refuses: unbalanced or one-line entries (at commit), writes into a locked month, changes to a posted entry's amounts, account, date or kind |
| **Jurnal Penyesuaian** | free-form adjusting entries · adjustment schedules (depreciation, amortisation, accruals reversed next month) whose monthly installment is proposed and posted on click · candidates from the ledger (fixed-asset purchases, prepayments, deferred revenue, recurring costs missing this month) |
| **Persediaan** | periodic method per entity: the month-end stock count (stock opname) is typed on *Persediaan* and the difference from the books is journaled to 1160 against 5190 Perubahan Persediaan, so HPP = persediaan awal + pembelian − persediaan akhir (CALK shows the computation) · close control asks for the count where there is inventory |
| **Aset Tetap** | fixed-asset register per entity (PSAK 16): register a purchase line, an existing depreciation schedule or a Saldo Awal asset — its straight-line schedule is created with it · accumulated depreciation and book value read from the GL · fiscal depreciation estimate per PMK 72/2023 group (garis lurus / saldo menurun, buildings, land) and the book − fiscal difference for the tax computation · disposal in one entry with the gain or loss on 7300 · close control register = ledger |
| **Piutang & Utang** | receivable/payable subledger: sales invoices and purchase bills (with PPN) post their journal, Saldo Awal items detail the opening balance · bank lines settle invoices (partial, one receipt for several), suggested by amount and the contact's name, classified to the receivable/payable account in the same click · tax withheld (PPh 23/22/4(2), PPh 21 on a purchase) is booked when the settlement closes the invoice, so the receivable/payable closes at gross (prepaid 1180 or liability 2140/2141/2145); the same *Pajak yang dipotong* option is on any bank line's *Ubah akun* (rent, services) · *Cocokkan FIFO*: one receipt against a customer's notes, oldest due first, the rest kept as that customer's advance (uang muka) · aging per contact (0 / 1–30 / 31–60 / 61–90 / > 90 days) with advances and cash not allocated yet · close controls open invoices − advances − unallocated = 1130 / 2110, and overpaid customers/suppliers · *Keluarkan dokumen*: a wrongly entered invoice reversed on its own date with a reason, kept struck through · sales by channel and customer (month and year to date) · CKPN (PSAK 109): provision matrix from the month-end aging (roll rates or manual rates, forward-looking factor), allowance journal 1135 / 6185 by click, close control · *Rekonsiliasi*: the client's own aging (XLSX/XLS/CSV, any header layout) per date against the ledger — difference and %, rounding kept apart, candidate causes (cut-off lines, advances and credit rows, accounts outside the aging, names on one side) with their sources, one Temuan per difference closed by a written explanation |
| **Sewa (PSAK 116)** | lease register per entity: present value of the payments (monthly / quarterly / semi-annual / annual, in advance or arrears) at the client's borrowing rate → aset hak guna and liabilitas sewa with the current / non-current split · amortisation schedule · commencement and monthly journals (depreciation, interest, reclass) by click · rent paid from the statement to 2170 · close control register = 1230 / 1239 / 2170 + 2400 · tax correction and deferred tax in the tax pack |
| **Imbalan Kerja (PSAK 24)** | post-employment benefits under PP 35/2021 per company: census import (Excel / CSV), the firm's own mortality table (uploaded once), assumptions → Projected Unit Credit DBO per employee with the DSAK 2022 attribution, service and interest cost, sensitivity ±1 % · journal by click (6105, remeasurement to 3920, first year to Saldo Laba) · December close control · deferred tax with the OCI part — an estimate, not an actuary's report |
| **Pajak Badan** | PPh badan pack per company and year to date: laba komersial → koreksi fiskal (depreciation from the asset register, final-taxed interest, correction categories suggested by account name with a %, manual beda tetap/waktu) → kompensasi kerugian (5 years, oldest first) → PKP → 22 % with Pasal 31E, or PP 55/2022 final 0,5 % (journaled Dr 8200 / Cr 2145, cleared by the monthly payments) → credits (PPh 25 from the statement by masa pajak — the month before payment unless set —, bukti potong) → PPh 29 / 28A and next year's PPh 25 · deferred tax from the asset register, the CKPN allowance, leases and employee benefits (OCI part to 3920) · current and deferred tax journals posted by click as differences · December close control · Excel kertas kerja (7 sheets) — an estimate for the working papers, never an SPT |
| **Pajak Masa** | Per company and month in Rupiah: PPN (keluaran − masukan, lebih bayar carried forward; the masa-end *kompensasi PPN* journal Dr 2130 / Cr 1150 by one click), PPh 21, PPh 23 and the other withholdings, PPh 25 angsuran (typed from a masa onward), each judged on what was booked for the masa against the bank payments filed to its account by the due date (PPh the 15th, PPN the end of the next month) · older balances shown apart · PPh 21 remitted with nothing withheld flagged (payroll booked net) · *Bukti potong (Unifikasi)*: payments the company withheld from (contact, NPWP, gross, withheld) and receipts its customers withheld from · PPh 21 TER (PP 58/2023) estimate per employee from the census wage and PTKP status, against the GL · Excel kertas kerja (3 sheets) — a worksheet for Coretax, never an SPT |
| **Reports** | *Final* (closed, by whom) or *Draf* with what keeps it one — lines in Review, 1999, missing statements, due schedules, stock count — on the page and in the Excel · comparatives only where the books hold data (the Saldo Awal position when the books start in the year) · Neraca Saldo with opening / movement / closing, Laba Rugi (month + YTD + the same months last year, then other comprehensive income), Neraca (vs last month and 31 December, current / long-term liabilities, lines open into client accounts), Laporan Perubahan Ekuitas, Laporan Arus Kas (indirect), CALK draft with register detail and the statement of responsibility (Direksi for a PT, Pemilik/Pengurus for a CV or an individual), worded for each entity's *kerangka pelaporan* (SAK EMKM / SAK EP / SAK Umum, set on Tambah klien or in the client settings; wording only, no figure changes), the whole set as one Excel download (totals as formulas) and one PDF ready to send (header and page numbers on every page, DRAF while open, CALK parts management must write marked) · a report format per client (*Format laporan*: its own labels, order, headings, totals and Rupiah or thousands, checked so no account drops out and the results stay right; presentation only) · an account on a line outside its statement shows as *belum terpetakan*, never dropped · a *tahun buku* per client (e.g. 1 Februari – 31 Januari): year to date, comparatives, registers and year-end controls count from its first month; Pajak Badan stays calendar-year only and says so · Kertas Kerja Gabungan with intercompany elimination, drill-down to source · **Paket kredit bank** (one company, Excel): Ringkasan, the statement set, *Mutasi vs Omzet* for 12 months (money in less own transfers, loans & capital and unclassified lines, against revenue), receivable and payable agings, fixed assets and *Jejak Sumber* (where every account's lines came from) · **Laporan manajemen** (one company, Excel): the month against last month and the year to date, margins, cash and plain commentary built only from those numbers, plus every P&L account against its usual month · **Catatan manajemen** (tab on Laporan Keuangan): the computed sentences, an optional AI rewording whose every number must appear in them, and the note the accountant approves — the workbook carries it while the books still match |
| **Close** | Automatic controls per entity + group (TB, A=L+E, bank recon per account, continuity, clearing, suspense, intercompany), sanity checks (incl. capital deficiency and trading revenue without cost of sales) and ledger anomaly scans (flux vs the last 3 months, P&L against its nature, new or reactivated accounts, possible duplicates), scheduled installments still to post, fixed-asset register and receivable/payable subledgers vs ledger, the year's PPh badan in December, AI explanation of all flagged controls or *Jelaskan* per control with a grounded draft correction (posted on click) or draft note, correction proposals for 1999 differences from ledger files, notes, sign-offs, lock in order (a month closes only after earlier months with activity; reopening runs in reverse, admin only, with a reason kept in the unlock log) · a control note stops counting when the control's detail changes; reopening a month clears its sign-offs · **Papan kantor** on Beranda: per client, *Sumber* (data complete this month), *Review*, *Tutup buku* and *Terkirim* (the first report downloaded after the lock) · `npm run close:timeline` prints first file in → lock → report sent per client-month |
| **Document evidence** | Financial statements, company profiles, and supporting documents · versioned sources · reviewed company context · cited questions before posting · [support and limits](docs/evidence-workspace.md) |
| **Demo** | 3 synthetic clients × 6 months seeded through the real pipeline; [5-minute investor script](docs/demo/investor-demo.md) |

## Quick start
```bash
cp .env.example .env            # then set a DEMO_ADMIN_PASSWORD (≥ 8 chars)
npm run auth:local              # local Supabase Auth in Docker (the stack CI uses); writes its URL + keys into .env
docker compose up -d            # Postgres 16 (or `brew install postgresql@16` + create role/db `buku`, and `buku_test` for tests)
npm ci
npx prisma migrate deploy
npm run demo:reset              # seed "KJA Demo & Rekan" + the demo admin (≈5 s, no AI credit used)
npm run dev                     # http://localhost:3000/login → DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
```
Identity lives in Supabase Auth ([ADR 0010](docs/adrs/0010-supabase-platform.md)). Production is the only hosted environment
([ADR 0015](docs/adrs/0015-production-only.md)); local development uses a throwaway local Supabase stack and a local database, so
nothing you do locally touches production users or books. To invite a real address instead of the demo admin:
`npm run access -- list` (firm ID) then `npm run access -- invite --firm FIRM_ID --email you@example.com --name "Nama" --role ADMIN`.
For an empty non-demo database, `npm run access -- init --name "Your firm"` creates the firm first.

Agents with a session-start hook run `scripts/session-start.sh` automatically (Postgres, deps, migrate, seed); otherwise run it first.

## Commands
| | |
|---|---|
| `npm run access -- list` / `invite` / `revoke` | Operator-only account provisioning; explicit `--firm` and `--email`; no roles or public signup |
| `npm test` | Vitest: unit + Postgres + demo-vs-ground-truth (uses `buku_test`) |
| `npm run verify:books` | Recompute ~1,000 balances from generator truth and compare with the app → `ALL PASS` |
| `npm run build && npm run test:e2e` | Playwright investor walk against `next start` |
| `npm run ai:smoke` | One real, capped LLM call to check the AI key + model (Pengaturan, else `.env`) |
| `npm run inspect:statement -- <file>` | Parse a statement without the DB: format, balances, continuity (per account for combined PDFs). `--lines` dumps PDF text positions; `PDF_PASSWORD=…` for locked PDFs |
| `npm run verify:real -- chickin\|goers\|smbc\|all` | Local only: import real files from `data/private/` and compare Buku with the files ([docs/real-data.md](docs/real-data.md)) |
| `npm run close:timeline -- [--client <id\|name>] [--period YYYY-MM]` | Read-only: per client-month, first file in → lock → first report sent after the lock ([docs/real-month.md](docs/real-month.md)) |
| `npm run lint` · `npm run typecheck` | |

## Stack
Next.js 16 (App Router, server actions) · TypeScript · Tailwind v4 · shadcn (base-nova) · Recharts · Prisma 7 + Postgres
(Supabase Postgres in production) · Vitest · Playwright. LLM via any OpenAI-compatible endpoint — OpenCode Zen by default.

## Environment
| Var | |
|---|---|
| `DATABASE_URL` | Postgres URL. On Vercel the Supabase integration provides `POSTGRES_PRISMA_URL` (pooled, used at runtime) and `POSTGRES_URL_NON_POOLING` (migrations) |
| `DEMO_MODE` | `true` enables synthetic demo fixtures; database reset remains an explicit operator command |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The environment's Supabase project (Auth). Integration names `NEXT_PUBLIC_SUPABASE_ANON_KEY` also work |
| `SUPABASE_SECRET_KEY` | Server-only admin key (or `SUPABASE_SERVICE_ROLE_KEY`): invitations, revocation, demo admin, e2e |
| `APP_URL` | Public origin for invite / reset links. Empty = request origin (pages) or the Supabase project's Site URL (CLI) |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | Demo admin created by the seed; refused unless `DEMO_MODE=true` |
| `INITIAL_FIRM_NAME` / `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_NAME` | Build-time bootstrap of a real workspace: first firm + first admin invitation, once |
| `EVIDENCE_ENABLED` | Same authenticated document workspace in both environments; `false` is an operational kill switch |
| `AI_BASE_URL` | LLM gateway (default OpenCode Zen). Env-only on purpose, so a stored key can't be redirected |
| `AI_API_KEY` / `AI_MODEL` | Fallback when nothing is saved in **Pengaturan**. Empty = rules + memory only (fully functional) |
| `SETTINGS_SECRET` | ≥ 32 chars. Encrypts the AI key saved in Pengaturan and the Drive token. Changing it means re-saving / reconnecting |
| `AI_MAX_CALLS_PER_IMPORT` / `AI_MONTHLY_TOKEN_BUDGET` | Credit guards (defaults 3 / 200 000) |
| `AI_TIMEOUT_MS` / `AI_LONG_TIMEOUT_MS` | Optional per-call timeouts (defaults 90 000 for classification/mapping, 180 000 for close review and *Jelaskan*) |

## Deploy (Vercel + Supabase)
Supabase organisation **Rightjet**, project `native-erp-v2` in `ap-southeast-1`: production, the only hosted environment
([ADR 0015](docs/adrs/0015-production-only.md)). The former `native-erp-v2-staging` project is unused.
1. **Connect Supabase to the Vercel project** (Vercel → Integrations → Supabase): production ↔ `native-erp-v2`. The integration injects `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` per environment — no database password is typed anywhere.
2. **Env vars** (Settings → Environment Variables): `DEMO_MODE` per the table below, `SETTINGS_SECRET`, `EVIDENCE_ENABLED=true`, `APP_URL`,
   and optionally `AI_BASE_URL`. Production: `INITIAL_FIRM_NAME` + `INITIAL_ADMIN_EMAIL` (the build invites that admin once).
   The AI key + model are set in **Pengaturan** by an admin.
3. **Supabase Auth settings** (done in the dashboard): Site URL = the production origin, redirect allow-list `<origin>/auth/callback`,
   *Allow new users to sign up* **off**, minimum password length 8, Data API **off** (Prisma owns `public`; nothing is exposed via PostgREST).
   **Custom SMTP** (Authentication → Emails → SMTP) is required before invitations reach addresses outside the Supabase organisation;
   the Bahasa templates to paste are in `supabase/templates/`.
4. **Connect Git** (Settings → Git): `ismailir10/native-erp-v2`; production branch `main`.
5. **Access**: application login is required. Production is the one real workspace ([ADR 0008](docs/adrs/0008-one-workspace.md), releases per [ADR 0011](docs/adrs/0011-main-only-releases.md), the only hosted environment per [ADR 0015](docs/adrs/0015-production-only.md)). Never point local development, seeds or e2e at it.
6. Functions run in `sin1` (Settings → Functions), the same region as the Supabase projects — every page runs many queries.

| Vercel environment | Supabase project | `DEMO_MODE` | Who sees it |
|---|---|---|---|
| Production (`main`) | `native-erp-v2` | `false` | Invited accountants. **The real workspace**, see [docs/real-data.md](docs/real-data.md) |
| Local development, CI, e2e | local stack (`npm run auth:local` / `supabase start`) | `true` | You. Synthetic, disposable |

Git deployments are on for `main` only (`vercel.json` → `git.deploymentEnabled`): PRs and other branches build no preview, so every
merge to `main` is one production deploy.

`vercel-build` (`scripts/vercel-build.sh`) then runs `prisma migrate deploy` on the non-pooling URL, seeds the demo **only if the
database is empty**, runs the first-admin bootstrap, and builds. `npm run demo:reset` is destructive operator tooling: it removes all
demo database data, including members; the demo admin is recreated by the seed. The shared UI cannot trigger it. Supabase Storage,
Edge Functions, Realtime and Row Level Security are not used: the server is the boundary and Prisma connects as `postgres`.

### Invitation operations

```bash
npm run access -- list                                                                        # firms and members with roles
npm run access -- invite --firm FIRM_ID --email accountant@example.com --name "Accountant" [--role ADMIN|AKUNTAN] [--url https://origin]
npm run access -- revoke --firm FIRM_ID --email accountant@example.com
```

Run these with `.env` pointing at the intended environment (its database URL, Supabase URL and secret key). `invite` creates the
Supabase user and the firm member together and sends the invitation email; the link opens */atur-sandi* where the person sets a
password and lands in the workspace. `revoke` disables the member (checked live on every request, so it takes effect at once) and bans
the Supabase user; re-inviting lifts both and sends a fresh password link. An address cannot be moved to another firm implicitly.
Roles: **ADMIN** may change the AI credentials, connect Google Drive and delete a client (client *Pengaturan* → *Hapus klien*, typed name, removes all its books — for clients entered by mistake or test copies); **AKUNTAN** does everything else. *Lupa kata sandi?* on the
login page sends a reset link and never reveals whether the address is a member. *Keluar* ends the session on that device only.

Missing Supabase configuration keeps the workspace closed and shows a setup message instead of a server error.

E2E creates its members through the Supabase admin API of the local stack (CI and laptops alike: `npm run auth:local`) and logs in
through the real form. Its setup refuses a non-localhost database. It never sends mail or enables an authentication bypass. `.playwright/` holds the ephemeral
session and credentials and is ignored by Git.

## Branch workflow

`main` is the repository default, the base for new work and production. Create a temporary `task/<slug>` branch from current
`main`, open its PR against `main`, and merge after CI passes — the merge deploys to production. GitHub automatically deletes the
merged task branch; remove its local copy after returning to `main`. `staging` is frozen history ([ADR 0015](docs/adrs/0015-production-only.md)).
Both branches are protected from deletion and force-push, and require the CI `check` result.

Supabase: project `native-erp-v2` (the real workspace, git `main`). Nothing else is hosted; development runs on the local stack.

## For contributors (humans and agents)
Read [AGENTS.md](AGENTS.md) (also reachable as `CLAUDE.md`): the spec → build → ship loop, gates, and which skill (`.agents/skills/`) governs which folder.
Decisions live in [docs/adrs](docs/adrs/README.md). Demo data is synthetic — never commit real client statements.

## Document evidence workspace

`/documents` is the same authenticated workspace in every environment. It accepts mixed uploads or read-only Drive folders, retains versioned evidence, prepares imports and company context, and answers cited questions before posting. `/clients/[id]/documents` redirects into this shared view with the client scope. Collections can span periods; this is stated explicitly, while question and report periods remain in the URL. Setup and limits: [docs/evidence-workspace.md](docs/evidence-workspace.md). Architecture: [ADR 0007](docs/adrs/0007-evidence-workspace.md). Core implementation lives in `lib/evidence/`.

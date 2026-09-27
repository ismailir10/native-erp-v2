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

Supported evidence formats include text PDFs, XLSX, CSV, Google Docs/Sheets, TXT, and Markdown. **Support depends on document structure:** scans require a text export, and ambiguous financial layouts remain searchable evidence rather than guessed figures. See [document support and limits](docs/evidence-workspace.md#supported-input-and-limits).

### Current experience and limits

**Available in this implementation:** invitation-only login with email + password (Supabase Auth; admin and akuntan roles), dashboard-level Tanya Buku, shared client/company and period selectors, prioritized work, document evidence and company-context review, financial reports, and controlled month-end close. Staging and main use the same authenticated application screens with separate databases, users, secrets, and provider settings.

**Tanya Buku supports bounded read-only questions:** close readiness, posted profit/revenue, cash and account balances, document search, and company context. Its portfolio answers are calculated with deterministic tools; unsupported questions say so. Answers retain the scope and period at submission, with source links and session-only history. Document-specific AI tools remain available within their existing budget controls. Cross-client views compare companies in their own currencies; they do not consolidate them. Always-on agents and live bank feeds are not implemented.

Review the [standalone, clickable HTML prototype](docs/prototypes/buku-workspace.html) and its [review guide](docs/prototypes/README.md). Download the HTML and open it in a browser, or serve this repository locally. All prototype data, answers, sign-in, and accounting actions are simulated; no production changes or API calls occur.

> Current deployment and real-data boundaries are documented below and in [docs/real-data.md](docs/real-data.md). Development history: [docs/cycles](docs/cycles/).

## What it does
| Area | |
|---|---|
| **Import** | PDF e-statements (text, password-protected, combined multi-account e.g. SMBC), KlikBCA CSV, Mandiri XLSX, BRI CSV, generic column detection · running-balance continuity check · dedupe on re-upload |
| **Ledger / Neraca import** | GL or Neraca from Jurnal/Accurate/Excel (XLSX, CSV) · source checks with row refs (unbalanced groups, broken cells, reused codes, foreign lines without rate) · each entity keeps its own chart, mapped to Buku's by rules → AI (names only) → accountant · all-or-nothing posting · Neraca sub-headings (current / long-term) steer suggestions · an entity with its own chart opens Buku Besar and Neraca Saldo in *Akun klien*, each with its own ledger down to `sheet!row` |
| **Multi-currency** | functional currency per entity · fx lines with rate · Kurs page (typed-in / from file, never fetched) · month-end revaluation on click · Gabungan translated to IDR (closing / average / historical, CTA line) |
| **Onboarding** | Tambah klien (entities + bank accounts, template COA) · Saldo Awal per entity (plug to 3200) |
| **Classify** | transfer matcher (own accounts → 1199, group entities → 1190) → rules → learned memory → LLM (cached, capped) → review |
| **Ledger** | double entry, BigInt Rupiah, immutable entries, reclass-by-difference, period locks, PPN 11% split |
| **Reports** | Neraca Saldo with opening / movement / closing, Laba Rugi (month + YTD), Neraca (comparative, current / long-term liabilities, lines open into client accounts), Kertas Kerja Gabungan with intercompany elimination, drill-down to source |
| **Close** | Automatic controls per entity + group (TB, A=L+E, bank recon per account, continuity, clearing, suspense, intercompany), notes, sign-offs, lock |
| **Document evidence** | Financial statements, company profiles, and supporting documents · versioned sources · reviewed company context · cited questions before posting · [support and limits](docs/evidence-workspace.md) |
| **Demo** | 3 synthetic clients × 6 months seeded through the real pipeline; [5-minute investor script](docs/demo/investor-demo.md) |

## Quick start
```bash
cp .env.example .env            # then paste the *staging* Supabase keys (Settings → API keys) and a DEMO_ADMIN_PASSWORD
docker compose up -d            # Postgres 16 (or `brew install postgresql@16` + create role/db `buku`, and `buku_test` for tests)
npm ci
npx prisma migrate deploy
npm run demo:reset              # seed "KJA Demo & Rekan" + the demo admin (≈5 s, no AI credit used)
npm run dev                     # http://localhost:3000/login → DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
```
Identity lives in Supabase Auth ([ADR 0010](docs/adrs/0010-supabase-platform.md)); local development uses the staging project's Auth with a local
database, so nothing you do locally touches production users. To invite a real address instead of the demo admin:
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

## Deploy (Vercel + Supabase)
Supabase organisation **Rightjet**, two projects in `ap-southeast-1`: `native-erp-v2` (production) and `native-erp-v2-staging`.
1. **Connect Supabase to the Vercel project** (Vercel → Integrations → Supabase): production ↔ `native-erp-v2`, preview ↔
   `native-erp-v2-staging`. The integration injects `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` per environment — no database password is typed anywhere.
2. **Env vars** (Settings → Environment Variables): `DEMO_MODE` per the table below, `SETTINGS_SECRET`, `EVIDENCE_ENABLED=true`, `APP_URL`,
   and optionally `AI_BASE_URL`. Production: `INITIAL_FIRM_NAME` + `INITIAL_ADMIN_EMAIL` (the build invites that admin once).
   Preview: `DEMO_ADMIN_EMAIL` + `DEMO_ADMIN_PASSWORD`. The AI key + model are set in **Pengaturan** by an admin.
3. **Supabase Auth settings** (both projects, done in the dashboard): Site URL = the environment's origin, redirect allow-list
   `<origin>/auth/callback` (staging also the `native-erp-v2-*-ismails-projects-…vercel.app` wildcard and `http://localhost:3000`),
   *Allow new users to sign up* **off**, minimum password length 8, Data API **off** (Prisma owns `public`; nothing is exposed via PostgREST).
   **Custom SMTP** (Authentication → Emails → SMTP) is required before invitations reach addresses outside the Supabase organisation;
   the Bahasa templates to paste are in `supabase/templates/`.
4. **Connect Git** (Settings → Git): `ismailir10/native-erp-v2`; production branch `main`.
5. **Access**: application login is required on both staging and main. Production is the one real workspace ([ADR 0008](docs/adrs/0008-one-workspace.md)); staging keeps Vercel protection as an additional boundary and holds synthetic data only. Do not copy staging users or secrets into production.
6. Functions run in `sin1` (Settings → Functions), the same region as the Supabase projects — every page runs many queries.

| Vercel environment | Supabase project | `DEMO_MODE` | Who sees it |
|---|---|---|---|
| Production (`main`) | `native-erp-v2` | `false` | Invited accountants. **The real workspace**, see [docs/real-data.md](docs/real-data.md) |
| Preview, git branch `staging` | `native-erp-v2-staging` | `true` | Invited users + Vercel protection. Synthetic pre-production |
| Preview (PR branches) | `native-erp-v2-staging` | `true` | Invited users + Vercel protection |

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
Roles: **ADMIN** may change the AI credentials and connect Google Drive; **AKUNTAN** does everything else. *Lupa kata sandi?* on the
login page sends a reset link and never reveals whether the address is a member. *Keluar* ends the session on that device only.

Missing Supabase configuration keeps the workspace closed and shows a setup message instead of a server error.

E2E creates its member through the Supabase admin API (CI: a local `supabase start` stack; a laptop: the staging project's Auth from
`.env`) and logs in through the real form. It never sends mail or enables an authentication bypass. `.playwright/` holds the ephemeral
session and credentials and is ignored by Git.

## Branch workflow

Only `staging` and `main` are permanent branches. `staging` is the repository default and the base for new work.
Create a temporary `task/<slug>` branch from current staging, open its PR against `staging`, and merge after CI passes.
GitHub automatically deletes the merged task branch; remove its local copy after returning to staging.
Promote tested staging to production with a separate `staging` → `main` PR using a **merge commit** to preserve ancestry.
Both permanent branches are protected from deletion and force-push, and require the CI `check` result.

Supabase mirrors git: project `native-erp-v2` (real workspace, git `main`) and project `native-erp-v2-staging` (synthetic demo,
every preview). Nothing else. Staging keeps the `native-erp-v2-git-real-data-…vercel.app` domain for saved links; it serves the
synthetic staging database.

## For contributors (humans and agents)
Read [AGENTS.md](AGENTS.md) (also reachable as `CLAUDE.md`): the spec → build → ship loop, gates, and which skill (`.agents/skills/`) governs which folder.
Decisions live in [docs/adrs](docs/adrs/README.md). Demo data is synthetic — never commit real client statements.

## Document evidence workspace

`/documents` is the same authenticated workspace in both environments. It accepts mixed uploads or read-only Drive folders, retains versioned evidence, prepares imports and company context, and answers cited questions before posting. `/clients/[id]/documents` redirects into this shared view with the client scope. Collections can span periods; this is stated explicitly, while question and report periods remain in the URL. Setup and limits: [docs/evidence-workspace.md](docs/evidence-workspace.md). Architecture: [ADR 0007](docs/adrs/0007-evidence-workspace.md). Core implementation lives in `lib/evidence/`.

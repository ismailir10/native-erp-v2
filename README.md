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

**Available in this implementation:** invitation-only login (email codes or temporary shared access code), dashboard-level Tanya Buku, shared client/company and period selectors, prioritized work, document evidence and company-context review, financial reports, and controlled month-end close. Staging and main use the same authenticated application screens with separate databases, users, secrets, and provider settings.

**Tanya Buku supports bounded read-only questions:** close readiness, posted profit/revenue, cash and account balances, document search, and company context. Its portfolio answers are calculated with deterministic tools; unsupported questions say so. Answers retain the scope and period at submission, with source links and session-only history. Document-specific AI tools remain available within their existing budget controls. Cross-client views compare companies in their own currencies; they do not consolidate them. Always-on agents and live bank feeds are not implemented.

Review the [standalone, clickable HTML prototype](docs/prototypes/buku-workspace.html) and its [review guide](docs/prototypes/README.md). Download the HTML and open it in a browser, or serve this repository locally. All prototype data, answers, sign-in, and accounting actions are simulated; no production changes or API calls occur.

> Current deployment and real-data boundaries are documented below and in [docs/real-data.md](docs/real-data.md). Development history: [docs/cycles](docs/cycles/).

## What it does
| Area | |
|---|---|
| **Import** | PDF e-statements (text, password-protected, combined multi-account e.g. SMBC), KlikBCA CSV, Mandiri XLSX, BRI CSV, generic column detection · running-balance continuity check · dedupe on re-upload |
| **Ledger / Neraca import** | GL or Neraca from Jurnal/Accurate/Excel (XLSX, CSV) · source checks with row refs (unbalanced groups, broken cells, reused codes, foreign lines without rate) · each entity keeps its own chart, mapped to Buku's by rules → AI (names only) → accountant · all-or-nothing posting · *Akun sumber* TB |
| **Multi-currency** | functional currency per entity · fx lines with rate · Kurs page (typed-in / from file, never fetched) · month-end revaluation on click · Gabungan translated to IDR (closing / average / historical, CTA line) |
| **Onboarding** | Tambah klien (entities + bank accounts, template COA) · Saldo Awal per entity (plug to 3200) |
| **Classify** | transfer matcher (own accounts → 1199, group entities → 1190) → rules → learned memory → LLM (cached, capped) → review |
| **Ledger** | double entry, BigInt Rupiah, immutable entries, reclass-by-difference, period locks, PPN 11% split |
| **Reports** | Neraca Saldo, Laba Rugi (month + YTD), Neraca (comparative), Kertas Kerja Gabungan with intercompany elimination, drill-down to source |
| **Close** | Automatic controls per entity + group (TB, A=L+E, bank recon per account, continuity, clearing, suspense, intercompany), notes, sign-offs, lock |
| **Document evidence** | Financial statements, company profiles, and supporting documents · versioned sources · reviewed company context · cited questions before posting · [support and limits](docs/evidence-workspace.md) |
| **Demo** | 3 synthetic clients × 6 months seeded through the real pipeline; [5-minute investor script](docs/demo/investor-demo.md) |

## Quick start
```bash
cp .env.example .env
docker compose up -d            # Postgres 16 (or `brew install postgresql@16` + create role/db `buku`, and `buku_test` for tests)
npm ci
npx prisma migrate deploy
npm run demo:reset              # seed "KJA Demo & Rekan" (≈5 s, no AI credit used)
# Configure login settings described below, then provision the first invited user.
npm run access -- list           # find the local firm ID
npm run access -- invite --firm FIRM_ID --email accountant@example.com --name "Accountant"
npm run dev                     # http://localhost:3000/login
```
Before sign-in, set `BETTER_AUTH_URL` and a random `BETTER_AUTH_SECRET` of at least 32 characters. Choose `AUTH_MODE=email` with `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM`, or temporary `AUTH_MODE=shared-code` with a randomly generated 12-digit `AUTH_SHARED_CODE` stored only as a server secret. The invite command provisions access and sends no email. Shared-code mode requires an invited email plus the operator-provided code; it never sends mail. For an empty non-demo database, use `npm run access -- init --name "Your firm"` instead of seeding.

Claude Code sessions run `scripts/session-start.sh` automatically (Postgres, deps, migrate, seed).

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
(Neon in production) · Vitest · Playwright. LLM via any OpenAI-compatible endpoint — OpenCode Zen by default.

## Environment
| Var | |
|---|---|
| `DATABASE_URL` | Postgres URL (Neon pooled URL in production) |
| `DEMO_MODE` | `true` enables synthetic demo fixtures; database reset remains an explicit operator command |
| `BETTER_AUTH_URL` | Exact application origin for this environment; HTTPS outside localhost |
| `BETTER_AUTH_SECRET` | Random secret, at least 32 characters; distinct per environment |
| `AUTH_MODE` | `email` (default), or temporary `shared-code` for operator-distributed access |
| `AUTH_SHARED_CODE` | Random 12-digit server-only secret, required in shared-code mode; never a source-code constant |
| `RESEND_API_KEY` / `AUTH_EMAIL_FROM` | Email-code delivery key and verified sender; required only in email mode |
| `EVIDENCE_ENABLED` | Same authenticated document workspace in both environments; `false` is an operational kill switch |
| `AI_BASE_URL` | LLM gateway (default OpenCode Zen). Env-only on purpose, so a stored key can't be redirected |
| `AI_API_KEY` / `AI_MODEL` | Fallback when nothing is saved in **Pengaturan**. Empty = rules + memory only (fully functional) |
| `SETTINGS_SECRET` | ≥ 32 chars. Encrypts the AI key saved in Pengaturan. Changing it means re-saving the key |
| `ADMIN_PASSCODE` | Additional operator passcode for credential changes in Pengaturan; a workspace session is also required |
| `AI_MAX_CALLS_PER_IMPORT` / `AI_MONTHLY_TOKEN_BUDGET` | Credit guards (defaults 3 / 200 000) |

## Deploy (Vercel + Neon)
1. **Connect Neon to the Vercel project**: Vercel → project → *Storage* → *Connect Database* → Neon → the existing project
   with the branch per environment from the table below. This injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
2. **Env vars** (Settings → Environment Variables): `DEMO_MODE` per the table below, `SETTINGS_SECRET`, `ADMIN_PASSCODE`, and optionally `AI_BASE_URL`.
   Also configure the login URL, signing secret, and the variables for the chosen login mode and `EVIDENCE_ENABLED=true` in each environment. Provision at least one invited user for that environment before routing users to the new version. The AI key + model are set in **Pengaturan**.
3. **Connect Git** (Settings → Git): `ismailir10/native-erp-v2`; production branch `main`.
4. **Access**: application login is required on both staging and main. Production is the one real workspace ([ADR 0008](docs/adrs/0008-one-workspace.md)); staging keeps Vercel protection as an additional boundary and holds synthetic data only. Do not copy staging users or secrets into production.
5. Put Functions in the same region as the Neon database (Settings → Functions) — every page runs many queries.
   Neon `long-voice-58936160` is in `aws-ap-southeast-1`, so Functions run in `sin1`.

| Vercel environment | Neon branch | `DEMO_MODE` | Who sees it |
|---|---|---|---|
| Production (`main`) | `main` | `false` | Invited accountants. **The real workspace**, see [docs/real-data.md](docs/real-data.md) |
| Preview, git branch `staging` | `staging` | `true` | Invited users + Vercel protection. Synthetic pre-production |
| Preview (PR branches) | `staging` | `true` | Invited users + Vercel protection |

`vercel-build` (`scripts/vercel-build.sh`) then runs `prisma migrate deploy` on the unpooled URL, seeds the demo **only if the
database is empty**, and builds. `npm run demo:reset` is destructive operator tooling: it removes all demo database data, including invitations and sessions; re-provision users afterward. The shared UI cannot trigger it. Neon Auth / Functions / buckets are not used.

### Invitation operations

```bash
npm run access -- list
npm run access -- invite --firm FIRM_ID --email accountant@example.com --name "Accountant"
npm run access -- revoke --firm FIRM_ID --email accountant@example.com
```

Run these only against the intended environment. Revocation invalidates sessions and unused codes. Re-invitation starts a fresh session lifecycle; existing accounts cannot be moved to another firm implicitly. Email codes expire after five minutes and are stored hashed. Both modes enforce persistent request limits, exact-origin checks, and live revocation. Shared workspace access has no application roles.

**Temporary shared-code mode:** the code acts as a shared password and does not verify ownership of an email inbox; the account is not marked email-verified. Only existing, enabled invitations can sign in. The code is never returned by an API or included in browser assets. Verification is limited per address across IPs/instances. Rotate `AUTH_SHARED_CODE` and redeploy to reject the old code immediately on new login attempts; existing sessions last up to seven days unless their users are revoked. Switch back to `AUTH_MODE=email` once email delivery is ready.

Missing login configuration keeps the workspace closed and shows a setup message instead of a server error.

E2E uses a disposable localhost database, the real invitation/session flow in both login modes, and a captured test email transport. It never sends real messages or enables an authentication bypass. `.playwright/` contains ephemeral synthetic sessions and is ignored by Git.

## Branch workflow

Only `staging` and `main` are permanent branches. `staging` is the repository default and the base for new work.
Create a temporary `codex/<task>` branch from current staging, open its PR against `staging`, and merge after CI passes.
GitHub automatically deletes the merged task branch; remove its local copy after returning to staging.
Promote tested staging to production with a separate `staging` → `main` PR using a **merge commit** to preserve ancestry.
Both permanent branches are protected from deletion and force-push, and require the CI `check` result.

Neon mirrors git: branch `main` (real workspace) and branch `staging` (synthetic demo, the Neon default so any new
Neon branch copies demo data, never client data). Nothing else. Staging keeps the `native-erp-v2-git-real-data-…vercel.app`
domain for saved links; it serves the synthetic `staging` database.

## For contributors (humans and agents)
Read [CLAUDE.md](CLAUDE.md) (= `AGENTS.md`): the spec → build → ship loop, gates, and which skill governs which folder.
Decisions live in [docs/adrs](docs/adrs/README.md). Demo data is synthetic — never commit real client statements.

## Document evidence workspace

`/documents` is the same authenticated workspace in both environments. It accepts mixed uploads or read-only Drive folders, retains versioned evidence, prepares imports and company context, and answers cited questions before posting. `/clients/[id]/documents` redirects into this shared view with the client scope. Collections can span periods; this is stated explicitly, while question and report periods remain in the URL. Setup and limits: [docs/evidence-workspace.md](docs/evidence-workspace.md). Architecture: [ADR 0007](docs/adrs/0007-evidence-workspace.md). Core implementation lives in `lib/evidence/`.

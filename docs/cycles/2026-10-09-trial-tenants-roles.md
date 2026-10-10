# Trial access, tenants and roles: Buku → organisation → client → entity

Approval: the owner approved this Spec in session on 2026-10-09 ("approved, proceed"), including support sessions (A4) and the
professional surface (P1–P6).

## Context
Buku is in its trial phase. Today production holds one real firm ([ADR 0008](../adrs/0008-one-workspace.md)). People get in only
when the owner runs `npm run access -- invite` from a laptop ([ADR 0010](../adrs/0010-supabase-platform.md)). There are two roles,
ADMIN and AKUNTAN, and both see every client of the firm. Three groups feel this:

- **Prospects** (accounting firms and companies, both decks pitch to them) have no way to ask for a trial. Someone has to email the
  owner, who creates a firm and an invitation by hand.
- **The Buku operator** cannot see who has access, cannot give a firm 14 days, and cannot extend or end that access. Nothing stops
  either, because access has no end date.
- **Firms with staff** cannot keep a junior on two of their forty clients or give a partner read-only access. A company that keeps
  its own books has to pretend it is a "firm" with one "client".

A second tenant also exposes a single-tenant shortcut. The AI key, the model and the OCR switch are global rows in `AppSetting`, and
every firm ADMIN can change them (`app/settings-actions.ts`). Once trial firms exist, any trial admin could swap Buku's AI key.

A trial is also the first impression, and today some of the vendor shows through. The invitation and reset emails link to
`{{ .ConfirmationURL }}`, a `*.supabase.co/auth/v1/verify` address. They are two unstyled paragraphs. The sender comes from whatever
the project's SMTP says. The templates live in the hosted project by hand-paste (`supabase/config.toml` line ~229), so they drift.
They promise *berlaku 24 jam* while the local `otp_expiry` is 3600 s. `lib/auth/operator.ts` appends Supabase's raw English error
text to messages that a UI will soon show. There is no root `error.tsx` / `global-error.tsx`, so a crash shows Next's default
screen. The owner's bar: *Buku should look like finished software; nobody should see Supabase.*

**Outcome.** A prospect asks for a trial at `/daftar`. A Buku admin approves it in `/backoffice` and chooses a period. That creates
the organisation (an accounting firm or a company), its trial grant and an invitation for its owner. The owner sets a password,
invites the team and assigns roles. Accountants and viewers see only the clients assigned to them. When the period ends the
workspace becomes read-only: nothing is deleted, and reports can still be exported until Buku extends the grant. Tenant isolation is
proven by tests, not assumed.

### Target hierarchy
```
Buku (platform)                         PlatformAdmin — /backoffice, provisioned by CLI only
├── Organisation  kind=KANTOR_AKUNTAN   Firm row · AccessGrant[] · FirmMember[] (OWNER | ADMIN | AKUNTAN | VIEWER)
│   ├── Client 1                         ClientAccess decides which AKUNTAN / VIEWER see it
│   │   ├── Entity a                     books: one COA, periods and close per client (unchanged)
│   │   └── Entity b
│   └── Client 2
└── Organisation  kind=PERUSAHAAN       same Firm row; exactly ONE Client (the company's books), hidden in the UI
    └── (Client = the company)
        ├── Entity a
        └── Entity b
```
**Why a company is a firm with one hidden client.** The chart of accounts, periods, rules, close and every report are scoped per client
(`Client` → `Account`, `Period`, `Rule`, `ReportFormat` …), and a company with several entities is exactly what a client with several
entities already is (combined view, transfers between entities). Keeping that row means no ledger, report or close code changes, and no
accounting invariant moves. Only navigation and copy change.

### Roles (one source of truth: `lib/auth/permissions.ts`)
| Capability | OWNER *Pemilik* | ADMIN | AKUNTAN | VIEWER *Peninjau* |
|---|:-:|:-:|:-:|:-:|
| See assigned clients' books and reports, export Excel/PDF | all clients | all clients | assigned | assigned |
| Import, review, post, adjust, sign off, lock a month | ✓ | ✓ | ✓ | – |
| Create a client (firm) / add an entity | ✓ | ✓ | ✓ (auto-assigned) | – |
| Unlock a month, remove an import, close many months at once, delete a client | ✓ | ✓ | – | – |
| Connect Google Drive, org settings (OCR switch per org) | ✓ | ✓ | – | – |
| Invite / disable members, change roles, assign clients | ✓ | ✓ (not OWNERs) | – | – |
| Transfer ownership | ✓ | – | – | – |
| AI provider key and model, AI budgets, access grants | Buku admin only (backoffice) | | | |

For PERUSAHAAN every member sees the single client, so assignment does not apply.

### Access state (computed, never stored: `lib/access/grant.ts`)
| State | When | Effect |
|---|---|---|
| `ACTIVE` | an unrevoked `AccessGrant` covers *now* (`endsAt` null = no end) | normal |
| `READ_ONLY` | grants existed but all have ended | log in, read, export; every write and AI call refused with *Masa akses berakhir pada … Hubungi Buku untuk memperpanjang.* |
| `NONE` | no grant ever, or every grant revoked, or `Firm.suspendedAt` set | an *Akses ditutup* page; no data shown |

A grant ends at 23:59:59 Asia/Jakarta on its end date.

## Spec
**Platform and grants**
- [ ] **A1** A `PlatformAdmin` (separate from `FirmMember`; created and removed only by `npm run access -- operator add|remove`) can open
  `/backoffice`. Anyone else gets 404. The backoffice shows organisations (name, kind, owner email, members, clients, entities, AI tokens
  this month, last activity, access state with days left). The list itself shows no books. Seeing books goes only through a support
  session (A4).
- [ ] **A2** In the backoffice a Buku admin can create an organisation directly, give a grant (TRIAL / PAID / COMP, start and end date,
  note), extend it, revoke it, and suspend or reinstate an organisation. Every change is a `PlatformAuditEvent` naming the Buku admin.
  That is a platform-side log, never shown to tenants: `AuditEvent` is per client and appears in the tenant's *Riwayat*. The CLI gets
  the same operations (`access grant|revoke-grant|suspend`).
- [ ] **A3** The AI key, model and OCR switch are edited only in the backoffice. Org *Pengaturan* shows their status read-only.
  `Firm.aiMonthlyTokenBudget` (null = the `AI_MONTHLY_TOKEN_BUDGET` default) is set per organisation in the backoffice, and
  `lib/ai/budget.ts` reads it.
- [ ] **A4 Support session ("masuk sebagai").** From an organisation in the backoffice, a Buku admin clicks *Buka ruang kerja*,
  picks the member to view as (default: the OWNER, or any member to reproduce their exact view and client assignment), types a
  reason (min. 10 characters), and lands in that tenant's normal dashboard. Rules:
  - **Quiet.** The tenant gets no notification, banner or email, and nothing appears in their *Riwayat*, *Tim* or activity. Only
    the Buku admin sees a fixed top bar: *Mode dukungan · <org> · sebagai <member> · sisa 52 menit · Keluar*.
  - **Read-only, always.** Every guarded write (T04) and every AI call is refused with *Mode dukungan hanya baca*. Pages that write
    lazily on read (e.g. creating a `Period` row) skip the write in support mode. Exports work, but they log to the platform log,
    not to the tenant's `AuditEvent`. Writing as the client is a non-goal: entries record who posted them, and posting as their
    accountant would falsify their audit trail.
  - **Bounded.** A session lasts at most 60 minutes, ends on *Keluar* or logout, and needs a fresh reason to restart. It works
    whatever the tenant's access state is, even NONE or suspended, because troubleshooting a closed account is part of the job.
  - **Recorded on Buku's side.** `SupportSession` (admin, org, member viewed as, reason, start, end) and `SupportSessionView`
    (path + time for each page and export) are append-only. The backoffice shows them per organisation and per admin.
  - **Stronger login for admins.** A support session requires the Buku admin to have Supabase MFA (TOTP) at `aal2`. The backoffice
    shows *Aktifkan verifikasi dua langkah* until it is set up.
  - **Disclosed in the terms.** The Terms of Service and Privacy policy shown at `/daftar` state that Buku support may access
    workspace data, read-only, to troubleshoot (UU PDP). That copy is an owner action, and the page links it.

**Signup**
- [ ] **S1** Public `/daftar`: name, work email, organisation name, kind (*Kantor akuntan* / *Perusahaan*), optional WhatsApp
  number and note. It always answers *Terima kasih — kami kirim email setelah akses disetujui*, whether or not the address is known.
  A honeypot field and a per-email and per-IP limit (DB-backed, no new dependency) stop floods. Supabase self-signup stays off.
- [ ] **S2** The backoffice lists pending requests. *Setujui* (default 14 days, or 30 days, or a chosen date) creates the
  organisation, its single client if PERUSAHAAN, a TRIAL grant and an OWNER invitation (reuses `inviteUser`). It is all or nothing:
  a failed invitation rolls the organisation back. *Tolak* records a reason and sends no email. Approving an address that is
  already a member is refused.
- [ ] **S3** The invited owner sets a password at `/atur-sandi` and lands on Beranda. An empty PERUSAHAAN lands on its entity setup.

**Tenancy and roles**
- [ ] **T1** The session resolves `{ member, firm, access, clientIds }` once per request. `getClientForFirm` is replaced by a resolver
  that refuses a client outside the member's organisation or assignment with the same "not found" as a missing id.
- [ ] **T2** Every write path calls a guard that checks access state + capability + client assignment: every exported function
  of `app/*actions.ts`, `app/api/**` and `app/kirim/**/upload` (an expired or suspended organisation's upload link stops taking files).
  A unit test parses those files and fails when an exported server action calls no guard.
- [ ] **T3** Every read path lists only accessible clients: sidebar, Beranda, work board, reports, documents and the workspace
  question scope. A DB test with two organisations and an assigned AKUNTAN proves no cross-organisation or unassigned id resolves.
- [ ] **T4** *Pengaturan → Tim* (OWNER/ADMIN): list members, invite (email, name, role), change role, disable or enable, and assign
  clients to AKUNTAN/VIEWER. Rules: at least one active OWNER always; an ADMIN cannot change an OWNER; `Firm.seatLimit` (set in the
  backoffice, trial default 5) caps active members.
- [ ] **T5** Read-only and expiry UX: a banner in the app shell when ≤ 7 days are left (*Uji coba berakhir dalam 3 hari*). In
  READ_ONLY a calm banner replaces write buttons with the reason, and export keeps working. NONE shows *Akses ditutup*.

**Company organisations**
- [ ] **C1** For PERUSAHAAN, Beranda goes straight to the company's books and the sidebar shows entities, not clients. *Klien* copy,
  *Klien baru* and *Hapus klien* are gone. Adding an entity works as today. The server refuses a second client.

**Professional surface: no vendor visible**
- [ ] **P1** Every email a user receives (invitation, password reset, and any other Supabase mail left enabled, such as a password
  changed notice) is a branded Buku email. It has the Buku logo and colours, Bahasa copy, a clear button plus a plain link,
  the validity stated correctly, and a footer with Buku's name and a support address. The invitation names the organisation and,
  for a trial, the end date (`{{ .Data.org_name }}`, `{{ .Data.access_until }}` from the invite metadata), with firm or company
  wording. It renders correctly in Gmail (web and Android), Outlook and Apple Mail at 375 px and on desktop.
- [ ] **P2** Every link in those emails points to Buku's own domain:
  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite|recovery`, never `*.supabase.co`. `/auth/callback` shows a
  Buku page with a *Lanjutkan* button. The token is verified only on that POST, so mail scanners (Outlook Safe Links, Gmail
  prefetch) cannot use up the link. Expired or used links land on a Bahasa page with *Kirim tautan baru*.
- [ ] **P3** The sender is `Buku <noreply@<domain>>`, sent through custom SMTP (Resend, ADR 0010) on a domain with SPF, DKIM and
  DMARC passing. Replies go to the support address.
- [ ] **P4** The auth email config is code, not a hand-paste. `scripts/auth-config.ts` holds the templates, subjects, sender name,
  `site_url`, redirect allow-list and link validity. It shows a dry-run diff against the hosted project (Supabase Management API,
  plain `fetch`, the owner's token from env, never committed) and applies only with `--apply`. Local `config.toml` reads the same
  template files.
- [ ] **P5** No raw provider text reaches a user. Supabase and Prisma errors become Bahasa messages, and the raw text is logged
  on the server only. A unit test fails if a user-facing string contains `supabase`, `prisma`, `postgres` or an English provider
  error. App routes, `/login`, `/atur-sandi`, `/daftar` and `/backoffice` share a branded `not-found`, `error.tsx` and
  `global-error.tsx` (*Ada yang salah di sisi kami. Coba lagi, atau hubungi …*, with a reference id that matches the server log).
- [ ] **P6** Public pages (`/login`, `/daftar`, `/atur-sandi`, `/akses-ditutup`) have the Buku title, favicon and Open Graph
  card, and one visual shell that matches the app (ui-rules). A shared link previews as *Buku*.

**Migration of what exists**
- [ ] **M1** The existing production firm becomes KANTOR_AKUNTAN with one open-ended COMP grant, and every AKUNTAN gets `ClientAccess`
  to every existing client. Nobody notices a change. Roles are not rewritten by the migration: `FirmMember` is protected from
  migrations (`tests/unit/migration-protected-tables.test.ts`). Existing ADMINs keep ADMIN, which can do everything but transfer
  ownership, and the operator names the first OWNER once with `npm run access -- set-role` (Ship Notes).

**Gate-reopeners (flagged for approval):**
- **Schema migration.** New: `Firm.kind`, `Firm.suspendedAt`, `Firm.aiMonthlyTokenBudget`, `Firm.seatLimit`, `MemberRole` + OWNER,
  VIEWER, and the models `ClientAccess`, `AccessGrant`, `PlatformAdmin`, `SignupRequest`, `SignupThrottle`, `PlatformAuditEvent`, `SupportSession`,
  `SupportSessionView`. Backfill as M1.
- **ADR change.** [ADR 0017](../adrs/0017-trial-tenants-roles.md) (proposed in this PR): production becomes multi-tenant (updates
  0008); AI credentials move from firm ADMIN to Buku admin (updates 0010 §2); roles grow to four.
- **No new dependency. No AI credit use.** No accounting invariant changes: `postJournal()` and reports are untouched. The guard
  refuses a write before it reaches them. Attribution stays as in 0010 §3.
- **Deck:** `public/deck/kantor.html` line ~367 says *Hanya lewat undangan. Dua peran, Admin dan Akuntan* → update at `/ship` (trial
  request + four roles). `perusahaan.html` gains the company-organisation claim only once C1 has merged.

**Non-goals:** a Supabase custom domain; Buku sending its own transactional mail (an acknowledgement on `/daftar` would let
anyone trigger mail to any address; the on-screen confirmation covers it); billing or payment; one person in several organisations (an org switcher; the session shape keeps it possible
later); writing in a tenant's books from a support session; per-entity permissions; Postgres RLS (the server stays the boundary,
ADR 0010 §4); a policy for deleting expired trials; Google sign-in; email sent by Buku itself (only Supabase's invitation and reset
emails); copying the demo client into a trial.

**Assumptions:**
1. **Request then approve.** Supabase self-signup stays off. The approval sends the Supabase invitation, which proves the address.
   Opening signup, so people set a password and then wait for approval, is the alternative.
2. **An ended trial goes read-only and is never deleted.** Suspension (abuse) closes it completely.
3. The default trial is **14 days**. Each approval offers 30 days or a chosen date.
4. The company model is *an organisation with one hidden client*. The table stays `Firm`, because renaming it would touch 120+
   actions for no behaviour.
5. **One person, one organisation**, as today (`FirmMember.userId @unique`).
6. **Buku admins can open any tenant's workspace in a quiet, read-only support session (A4)**. The tenant is not notified; Buku logs
   every session on its own side, and the Terms disclose that support access exists. Changing a tenant's books stays the tenant's
   job.
7. The AI key belongs to Buku: trials spend Buku's credit, capped by a per-org monthly token budget (the trial default is the env
   default until set).
8. Four roles: OWNER / ADMIN / AKUNTAN / VIEWER, with labels *Pemilik / Admin / Akuntan / Peninjau*. AKUNTAN and VIEWER work only
   on assigned clients.
9. Supabase's custom SMTP (Resend, ADR 0010) already delivers invitations to outside addresses in production.
10. Buku has (or will have) its own domain for the app and for mail. A Supabase custom domain (a paid add-on) is **not** needed:
    with P2 no Supabase URL appears in an email or the address bar. Only the browser's network tab on `/atur-sandi` still shows it.

**Owner actions (outside the code, needed before the first external trial):** point a Buku domain at Vercel and set `APP_URL`;
verify that domain in Resend (SPF, DKIM, DMARC) and set it as Supabase custom SMTP, sender name *Buku*; choose a support address;
create a Supabase personal access token for `scripts/auth-config.ts` and run it once with `--apply`.

## How this cycle is worked (parallel pickup)
This doc is the contract. The tasks below are written so any agent or person can take one without the conversation that produced
them. The rules are:

1. **Wait for approval.** Nothing below starts until the owner approves this Spec on the PR.
2. **Claim before starting.** Push a one-line commit to this branch that turns `- [ ]` into `- [~]` and appends
   `(claimed: <handle>)`. Pull first. If someone else's claim is already there, pick another task.
3. **Respect dependencies and file ownership.** Start a task only when every task in its **after** list is `[x]`. Touch only the files
   it lists. If you need a change in another task's files, write it under *Handoffs* at the bottom of this doc instead of making it.
4. **One commit per task.** Run `npm run lint && npm run typecheck && npm test` before every commit. Subject
   `feat(scope): …`, body `Cycle: docs/cycles/2026-10-09-trial-tenants-roles.md`. Before pushing, `git pull --rebase` your own
   unpushed commits. Never force-push.
5. **Tick and log.** The same commit ticks the task `[x]` and adds 1–3 lines under *Implementation*: what was built, and anything
   the next task must know.
6. **Load the rules first.** `ui-rules` for `app/`, `components/`; `accounting-rules` for `prisma/`, `lib/ai/`; `demo-data` for seed
   and e2e. Read [AGENTS.md](../../AGENTS.md) first.

Waves (a wave can run in parallel once the one before it is done):
```
Any    T15 email templates+callback │ T16 auth config as code (after T15) │ T17 errors+public shell   (no schema dependency)
Wave 1  T01 schema ─▶ T02 permissions+grant (pure) ─▶ T03 session v2
Wave 2  T04 write guards │ T05 read scoping │ T06 backoffice shell        (after T03; T06 needs only T01)
Wave 3  T07 AI→backoffice │ T08 grants UI+CLI │ T10 trial UX │ T11 team │ T12 company UX │ T18 support session
Wave 4  T09 signup (after T08) ─▶ T13 seed+e2e walk ─▶ T14 docs, gates, ship notes
```

## Tasks
- [x] **T01 Schema + backfill migration.** After: none. Files: `prisma/schema.prisma`, `prisma/migrations/<ts>_trial_tenants/`,
  `lib/generated/**` (regenerated), `tests/db/tenancy-migration.test.ts`.
  `enum OrgKind { KANTOR_AKUNTAN PERUSAHAAN }` and `enum GrantKind { TRIAL PAID COMP }`. `MemberRole` gains `OWNER` and `VIEWER`.
  New `Firm` fields: `kind` (default KANTOR_AKUNTAN), `suspendedAt?`, `aiMonthlyTokenBudget Int?`, `seatLimit Int?`. Models:
  `ClientAccess { memberId, clientId, @@unique }`,
  `AccessGrant { firmId, kind, startsAt, endsAt?, note?, grantedById?, revokedAt?, revokedById?, createdAt }`,
  `PlatformAdmin { userId uuid unique, email unique, name, disabled, createdAt }`,
  `SignupRequest { email, name, orgName, orgKind, phone?, note?, status PENDING|APPROVED|REJECTED, reason?, firmId?, decidedById?, decidedAt?, ip?, createdAt }`
  `SignupThrottle { key, windowStart, count }`,
  `PlatformAuditEvent { adminId?, firmId?, kind, summary, before?, after?, createdAt }`,
  `SupportSession { adminId, firmId, asMemberId, reason, startedAt, expiresAt, endedAt? }` and
  `SupportSessionView { sessionId, path, kind VIEW|EXPORT, at }` (the last three append-only). SQL backfill per M1 (COMP grant with `endsAt` null for every existing firm,
  AKUNTAN × clients → ClientAccess; no role rewrite, see M1). Add a CHECK `endsAt IS NULL OR endsAt > startsAt`.
  — accept: `npm run db:migrate` on the seeded demo DB succeeds; the test asserts the backfill (grant exists, one OWNER, AKUNTAN
  assigned to all clients); all existing tests stay green.
- [x] **T02 Permissions + access state (pure).** After: T01. Files: `lib/auth/permissions.ts`, `lib/access/grant.ts`,
  `tests/unit/permissions.test.ts`, `tests/unit/access-grant.test.ts`.
  `type Capability` (`books.read`, `books.write`, `client.create`, `period.unlock`, `import.remove`, `close.batch`, `client.delete`,
  `org.settings`, `members.manage`, `org.transfer`) and `can(role, capability)` following the Roles table. `accessState(grants, firm, now)` returns
  `{ state, endsAt, daysLeft }`, with the Jakarta end-of-day rule. `ROLE_LABEL` moves here (four labels).
  — accept: table-driven unit tests cover every role × capability and every grant edge (open-ended, revoked, future-starting,
  overlapping, ends today 23:59 WIB, suspended).
- [x] **T03 Session v2 + client resolver.** After: T02. Files: `lib/auth/session.ts`, `lib/tenant.ts`, `tests/db/tenant-scope.test.ts`.
  `getWorkspaceSession()` also loads grants and assignments and returns `{ member, firm, access, clientIds: string[] | "ALL" }`. It returns
  null on NONE, and the `(app)` layout then sends the user to an *Akses ditutup* page (T10 styles it; T03 ships a plain one).
  `requireCapability(cap, { clientId? })` for actions throws `AccessError` (Bahasa message) on READ_ONLY writes, a missing
  capability or an unassigned client. `getClientForMember(clientId)` replaces `getClientForFirm` and keeps the old name as a deprecated
  re-export so T04 and T05 can migrate call sites in parallel. `accessibleClientWhere(session)` is the Prisma `where` used for lists.
  `requireMember(role)` maps to capabilities.
  — accept: the DB test sets up two orgs plus an assigned AKUNTAN and a VIEWER. A foreign client, an unassigned client and a READ_ONLY
  write each throw. An ADMIN resolves every client of its own org.
- [x] **T04 Guard every write path + coverage test.** After: T03. Files: `app/actions.ts`, `app/settings-actions.ts`,
  `app/evidence-actions.ts`, `app/google-actions.ts`, `app/workspace-actions.ts`, `app/api/**`, `app/kirim/[token]/upload/route.ts`,
  `lib/controls/index.ts`, `lib/controls/history.ts` and `lib/imports/remove.ts` (role checks → `can()`), plus `tests/unit/action-guards.test.ts`.
  Each exported action calls `requireCapability` with the narrowest capability and its `clientId`. The upload route checks the
  link's organisation state. The test reads every `"use server"` file and fails on an exported async function that calls no
  `requireCapability` / `getClientForMember` / `requirePlatformAdmin`.
  — accept: guard test green; `qa-access.spec.ts` still green; a READ_ONLY org's import returns the expiry message (DB test).
- [x] **T05 Read-path scoping.** After: T03. Files: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/work/**`,
  `app/(app)/reports/**`, `app/(app)/documents/**`, `app/(app)/clients/**/page.tsx` (resolver swap only), `lib/workspace/**`,
  `lib/queries.ts`, plus `tests/db/read-scope.test.ts`.
  Every client list uses `accessibleClientWhere`, and every client page uses `getClientForMember`.
  — accept: the DB test shows an AKUNTAN with one of two clients sees one on Beranda, the work board, reports and the workspace
  scope. A grep for `firmId: firm.id` client lists outside `lib/tenant.ts` comes back empty, or each hit is justified in Implementation.
- [ ] **T06 Platform admin + backoffice shell.** After: T01. Files: `lib/auth/platform.ts`, `app/backoffice/**` (layout and the
  organisations list), `lib/auth/operator.ts` (`addOperator`, `removeOperator`), `scripts/access.ts` (`operator add|remove|list`),
  plus `tests/db/platform-admin.test.ts`.
  `requirePlatformAdmin()` (live row, `disabled` respected) returns 404 to everyone else. The list shows the columns from A1
  (metadata only). Login is the same `/login`, and `/backoffice` is reached by URL.
  — accept: the DB test covers an operator vs a firm member vs a stranger. The CLI adds and removes an operator. A screenshot of the
  list (desktop + 390 px).
- [ ] **T07 AI + OCR settings move to backoffice; per-org budget.** After: T06, T04. Files: `app/settings-actions.ts` (AI parts),
  `app/backoffice/settings/**`, `app/(app)/settings/page.tsx` (read-only status), `components/app/ai-settings-form.tsx`, `lib/ai/budget.ts`,
  `lib/ai/provider.ts`, plus `tests/db/ai-budget.test.ts` (extend).
  — accept: a firm ADMIN can no longer save AI credentials (action refused, form gone). The budget uses
  `Firm.aiMonthlyTokenBudget ?? env`. Existing AI tests stay green, still with MockProvider only.
- [ ] **T08 Grants and organisations in backoffice + CLI.** After: T06, T02. Files: `lib/access/admin.ts` (createOrganisation,
  grant, extend, revokeGrant, suspend, reinstate, all writing `PlatformAuditEvent`), `app/backoffice/orgs/**`,
  `app/backoffice-actions.ts`, `scripts/access.ts` (`grant`, `revoke-grant`, `suspend`), plus `tests/db/access-admin.test.ts`.
  `createOrganisation(kind)` also creates the single client for PERUSAHAAN (reuse `createFirm`/`createClient` from `lib/setup.ts`).
  — accept: the DB test covers grant → ACTIVE, expiry → READ_ONLY, revoke → NONE, suspend → NONE, reinstate → back. Each writes a
  PlatformAuditEvent and no tenant `AuditEvent`. CLI round-trip.
- [ ] **T09 Public signup + approval queue.** After: T08. Files: `app/daftar/**` (public, outside `(app)`), `proxy.ts` matcher if
  needed, `lib/signup.ts` (submit, throttle, approve, reject), `app/backoffice/requests/**`, `tests/db/signup.test.ts`, `e2e/trial-signup.spec.ts`.
  Approve = createOrganisation + TRIAL grant + `inviteUser(role OWNER)`, with compensation on failure (pattern: `inviteUser`).
  The answer is always the same and leaks nothing. Copy is Bahasa (ui-rules).
  — accept: the DB test covers the throttle (6th request in an hour refused silently), approve (org + grant + owner), reject, a
  duplicate member address refused, and a failed invite leaving no org. The e2e walk (local Supabase stack) goes request →
  backoffice approve → owner gets a password link via the admin API → lands in the workspace with the trial banner.
- [~] **T10 Trial UX: banners, read-only, closed.** After: T03, T04. Files: `components/app/access-banner.tsx`,
  `app/(app)/layout.tsx` (banner slot only), `app/akses-ditutup/page.tsx`, the write buttons' disabled state through one
  `useAccess()` context (`components/app/access-context.tsx`), plus `e2e/trial-expiry.spec.ts`.
  — accept: the e2e test, with an org whose grant ended yesterday, can open a report and download Excel. The import button
  explains the expiry, and a forced server-action call returns the same message. With ≤ 7 days left the banner shows the count.
  Screenshots at desktop and 390 px.
- [~] **T11 Team management (Pengaturan → Tim).** After: T03, T04. Files: `app/(app)/settings/team/**`, `app/team-actions.ts`,
  `lib/team.ts` (invite via `inviteUser`, setRole, disable/enable via `revokeUser`-style, assignClients, transferOwnership, seat
  limit), `components/app/team-table.tsx`, plus `tests/db/team.test.ts` and `e2e/roles.spec.ts`.
  — accept: the DB test proves the last OWNER cannot be demoted or disabled, an ADMIN cannot touch an OWNER, and the seat limit
  holds. The e2e test covers an OWNER inviting an AKUNTAN with one client, who sees only it, and a VIEWER who sees reports but no
  import or review buttons.
- [~] **T12 Company organisation UX.** After: T05. Files: `app/(app)/page.tsx` (redirect branch), the `app/(app)/layout.tsx` sidebar
  section, `lib/org.ts` (`isCompany`, `companyClient`), the `createClientAction`/delete guards (one line each, coordinate via
  Handoffs if T04 is open), plus `e2e/company-org.spec.ts`.
  — accept: the e2e test shows a PERUSAHAAN org landing on its books, the sidebar listing entities, no *Klien* copy (text scan), and a
  second client refused by the server.
- [ ] **T13 Seed + demo + cross-cutting e2e.** After: T09, T10, T11, T12. Files: `lib/demo/seed*.ts`, `scripts/seed.ts`,
  `scripts/e2e-setup.ts`, `e2e/global-setup.ts`, `e2e/tenant-isolation.spec.ts`.
  The seed adds an open-ended grant to the demo firm, a demo PERUSAHAAN org (synthetic, 2 entities) and a local platform admin
  (DEMO_MODE only, refuses production as `ensureLocalAdmin` does).
  — accept: the e2e test, logged in as firm A, opens firm B's client URL and gets 404. `npm run verify:books` prints ALL PASS (demo
  numbers unchanged).
- [ ] **T14 Docs, end-of-cycle gates, Ship Notes.** After: all. Files: `README.md` (Invitation operations → Access operations:
  operators, grants, signup, roles), `AGENTS.md` §6 one line, `docs/adrs/0017-*.md` status → Accepted, `docs/adrs/README.md` row,
  and this doc. Deck per `/ship` step 3.
  — accept: lint + typecheck + test + build + verify:books + test:e2e all green, with the output pasted under Verification.

- [ ] **T15 Branded auth emails + scanner-safe callback.** After: none. Files: `supabase/templates/*.html` (invite, recovery,
  password-changed, email-change, magic-link and reauthentication, so every mail Supabase could send is branded), `supabase/config.toml`
  (template paths, subjects, `otp_expiry` matching the copy), `app/auth/callback/**` (GET renders a confirm page and POST verifies),
  `app/auth/callback/confirm-form.tsx`, plus `tests/unit/email-templates.test.ts` and `e2e/auth-links.spec.ts`.
  The templates are table-based inline-CSS HTML (no dependency): the logo is a hosted PNG on the Buku domain, with the button plus
  a plain link. They use `{{ .Data.* }}` with fallbacks so an invite without trial data still reads well. Coordinate the metadata
  keys with T09 under Handoffs.
  — accept: the unit test fails if a template contains `ConfirmationURL`, `supabase` or English copy, or if the validity text does
  not match `otp_expiry`. The e2e test (local stack, which captures mail in Inbucket/Mailpit) opens the invite mail. The link host
  is the app's, a GET alone does not consume it, *Lanjutkan* sets the session, and a second use shows the Bahasa *expired* page.
  Screenshots of both emails at 375 px and desktop.
- [ ] **T16 Auth email config as code.** After: T15. Files: `scripts/auth-config.ts`, the `package.json` script `auth:config`,
  `tests/unit/auth-config.test.ts`, and the README section (*Email & login appearance*).
  Read the template files and the subjects from `config.toml`, then build the Management API payload (`mailer_subjects_*`,
  `mailer_templates_*_content`, `site_url`, `uri_allow_list`, `mailer_otp_exp`, `smtp_sender_name`). `GET` the project's auth config,
  print a diff, and `PATCH` only with `--apply`. It refuses a project ref that is not in env, and it never prints a secret.
  — accept: the unit test builds the payload from the repo files and diffs it against a fixture config. A dry run against a fake
  `fetch` prints the expected diff. No network in tests.
- [ ] **T17 No vendor text, branded error pages, public shell.** After: none (touches `lib/auth/operator.ts` only at its `fail()`;
  if T06/T08/T11 are open, note it in Handoffs). Files: `lib/errors/user-message.ts` (provider error → Bahasa, logs raw + reference id),
  `lib/auth/operator.ts` (`fail()` uses it), `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/layout.tsx` metadata
  (title template, Open Graph, icons), `components/app/public-shell.tsx` (used by `/login`, `/atur-sandi`, later `/daftar` and
  `/akses-ditutup`), plus `tests/unit/no-vendor-text.test.ts`.
  — accept: the test scans `app/**`, `components/**` and `lib/**` user-facing strings (string literals in JSX and in `throw new Error(…)`)
  and fails on `supabase|prisma|postgres` (code identifiers and comments exempt). A forced render error shows the branded page with a
  reference id. Screenshots at desktop and 390 px.

- [ ] **T18 Support session (A4).** After: T04, T05, T06. Files: `lib/auth/support.ts` (start, end, resolve; an httpOnly cookie
  holding the session id, checked live against `SupportSession` and `PlatformAdmin` on every request), the `lib/auth/session.ts` branch
  (a platform admin with a live support cookie resolves to the target member's session with `support: {…}` and `access` forced
  read-only, so `requireCapability` refuses writes), `app/backoffice/orgs/[id]/support/**` (reason form, history),
  `components/app/support-bar.tsx`, the lazy-write sites found by the test below (guard with `if (session.support) skip`), the export
  routes' log call, plus `tests/db/support-session.test.ts` and `e2e/support-session.spec.ts`.
  — accept: the DB test snapshots row counts of every tenant table, walks every client page and export as a support session, and
  finds the counts unchanged, with only `SupportSession*` rows added. Every server action refuses. A session past 60 minutes or with a
  disabled admin resolves to nothing. The admin without `aal2` is refused. The e2e test: admin → *Buka ruang kerja* as an AKUNTAN
  sees exactly that member's assigned clients, then a tenant login in another browser shows no trace in *Riwayat* or *Tim*.
  Screenshots of the bar at desktop and 390 px.

## Implementation
- Plan: the critical path T01 → T02 → T03 goes first, on this branch (claimed: driver). T15, T16 and T17 have no schema
  dependency and are open for a second agent to take in parallel. Wave 2+ is claimed task by task after T03 lands.

- T01: `prisma/schema.prisma`, migrations `20261009232747_trial_tenants` (tables, CHECKs: grant period, seat limit, budget ≥ 0,
  support session ≤ 60 min and reason ≥ 10 chars; append-only triggers on `PlatformAuditEvent`, `SupportSession` (only ending it)
  and `SupportSessionView`) and `…_trial_tenants_backfill` (COMP grant per firm, AKUNTAN × clients), `lib/auth/permissions.ts`
  (`ROLE_LABEL`, `isAdminRole`), `tests/db/tenancy-migration.test.ts`. **Changed from the plan:** the backfill does not promote an
  ADMIN to OWNER, because `FirmMember` is protected from migrations and the guard test refused the UPDATE (see M1). **For later tasks:**
  every existing `role === "ADMIN"` check now reads `isAdminRole(role)`, so an OWNER is never weaker than an ADMIN. A firm created by
  `createFirm` after the migration has no grant yet; T03 gives `createFirm` a default open COMP grant.
- T02: `lib/auth/permissions.ts` (`Capability`, `can`, `isWrite`, `capabilityRefusal`), `lib/access/grant.ts` (`accessState`,
  `endOfDayJakarta`, `readOnlyMessage`). A revocation dated in the future has not happened yet; a grant that has not started yet gives
  NONE when nothing came before it and READ_ONLY in a gap between grants. `ROLE_LABEL` is re-exported from `lib/auth/session.ts` for
  the existing import sites.
- T03: `lib/auth/session.ts` (`resolveWorkspace` with access and `clientIds`, `getWorkspaceSession` cached per request, NONE →
  `/akses-ditutup`, `checkCapability`/`requireCapability`, `accessibleClientWhere`, `AccessError`; `requireMember` maps to
  capabilities), `lib/tenant.ts` (`getClientForMember`; `getClientForFirm` kept as a deprecated alias), `app/akses-ditutup/page.tsx`
  (plain, T10 styles it), `lib/setup.ts` (`createFirm` gives an open COMP grant unless a grant is passed; `createClient` assigns an
  AKUNTAN creator), `lib/onboarding.ts`, `lib/evidence/review.ts` and two actions pass the creator, and `lib/auth/operator.ts` (a CLI
  invite of an AKUNTAN/VIEWER gets every client, as before). **Bug caught while testing:** spreading the access `where` and then
  setting `id` overwrote an AKUNTAN's assignment list, so every lookup now uses `AND: [access, { id }]`. A unit test pins that.
- T04: `app/actions.ts` (`clientFor(capability, clientId)` / `writeClient` replace all 72 client lookups; unlock → `period.unlock`,
  multi-month close → `close.batch`, remove import → `import.remove`, delete client → `client.delete`, new client or entity →
  `client.create`; `AccessError` messages pass through `fail()`), `app/evidence-actions.ts` (an intake linked to a client checks that
  client), `app/google-actions.ts`, `app/settings-actions.ts`, `app/api/google/callback/route.ts` (`org.settings`), and
  `app/workspace-actions.ts` (an AI question counts as a write). `lib/upload-links.ts` `resolveUploadLink` refuses a link of an
  organisation that is not ACTIVE. `lib/controls` and `lib/imports/remove.ts` use `can()`. `capabilityRefusal` keeps the domain wording.
  Tests that mocked `@/lib/tenant` or `@/lib/auth/session` now fake only the login token and use real members (`tests/members.ts`).
  **Still open until T07:** AI key, model and OCR are `org.settings`, so any organisation ADMIN can still change Buku's AI key.
- T05: `lib/workspace` takes `WorkspaceAccess` (`{ firmId, clientIds }`) instead of a firm id, so Beranda, the work board, reports,
  documents and the question box are built from the member's clients only (`workspaceAccess(session)`). The sidebar uses
  `accessibleClientWhere`. Documents show unlinked intakes plus the member's clients' (`intakeVisibleWhere`), also on the intake and
  source pages. Client pages and downloads use `findClientForMember` (null → 404, while redirects still go through), and the deprecated
  `getClientForFirm` is gone. Remaining `firmId` client queries, all justified: `lib/clients/modules.ts` only annotates rows already
  scoped; `lib/auth/operator.ts` is CLI only; `lib/evidence/*`, `lib/upload-links.ts` and `lib/clients/delete.ts` check a client id
  their guarded caller passed; `lib/queries.ts` `clientStatuses` has no caller.

## Verification
- T01: full `npx vitest run`: 203 of 204 files passed; the one failure was `migration-protected-tables` refusing the backfill's role
  UPDATE. After removing it: lint ✓, typecheck ✓, and `tenancy-migration`, `migration-protected-tables`, `period-lock`, `close-history`
  and `remove-import` → 5 files, 51 tests passed.
- T02: `permissions.test.ts` and `access-grant.test.ts` → 2 files, 25 tests passed; lint ✓, typecheck ✓.
- T03: full `npx vitest run` → 207 files, 1390 tests passed; lint ✓, typecheck ✓.
- T04: full `npx vitest run` → 208 of 209 files, 1403 of 1404 tests; the one failure was `upload-links` resolving on a simulated
  September clock before the firm's grant started (test backdates the grant). Re-run: `upload-links` + `action-access` → 10 passed;
  `action-guards` → 9 passed; lint ✓, typecheck ✓.
- T05: full `npx vitest run` → 210 files, 1408 tests passed; lint ✓, typecheck ✓.

## Ship Notes

## Handoffs
- **For T05 (from T03):** client pages call `getClientForFirm(id).catch(() => notFound())`. That catch also swallows the
  redirect `requireWorkspaceSession` throws (to `/login` or `/akses-ditutup`), so the page shows 404 instead. No data leaks, but when
  T05 moves these sites to `getClientForMember`, rethrow framework errors first (`unstable_rethrow` from `next/navigation`).
- **For T04 (from T03):** `requireMember()` without a role maps to `books.read`, so it does not refuse writes while READ_ONLY. Move
  every write action to `requireCapability("books.write", { clientId })` or narrower.
- **For T06 (from T01):** add `npm run access -- set-role --firm ID --email ADDRESS --role OWNER|ADMIN|AKUNTAN|VIEWER` to
  `scripts/access.ts` and `lib/auth/operator.ts`. The migration no longer promotes anyone to OWNER (M1), so the operator names the
  first OWNER with it after deploy. Refuse demoting the last active OWNER.
<!-- Cross-task requests: "T12 needs createClientAction to call requireCapability('client.create') — owner T04". -->

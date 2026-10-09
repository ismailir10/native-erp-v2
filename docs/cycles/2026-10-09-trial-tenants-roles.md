# Trial access, tenants and roles: Buku → organisation → client → entity

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
  this month, last activity, access state with days left). It never shows books, transactions or files.
- [ ] **A2** In the backoffice a Buku admin can create an organisation directly, give a grant (TRIAL / PAID / COMP, start and end date,
  note), extend it, revoke it, and suspend or reinstate an organisation. Every change is an `AuditEvent` naming the Buku admin. The
  CLI gets the same operations (`access grant|revoke-grant|suspend`).
- [ ] **A3** The AI key, model and OCR switch are edited only in the backoffice. Org *Pengaturan* shows their status read-only.
  `Firm.aiMonthlyTokenBudget` (null = the `AI_MONTHLY_TOKEN_BUDGET` default) is set per organisation in the backoffice, and
  `lib/ai/budget.ts` reads it.

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

**Migration of what exists**
- [ ] **M1** The existing production firm becomes KANTOR_AKUNTAN with one open-ended COMP grant. Its earliest-created ADMIN becomes
  OWNER, and every AKUNTAN gets `ClientAccess` to every existing client. Nobody notices a change.

**Gate-reopeners (flagged for approval):**
- **Schema migration.** New: `Firm.kind`, `Firm.suspendedAt`, `Firm.aiMonthlyTokenBudget`, `Firm.seatLimit`, `MemberRole` + OWNER,
  VIEWER, and the models `ClientAccess`, `AccessGrant`, `PlatformAdmin`, `SignupRequest`, `SignupThrottle`. Backfill as M1.
- **ADR change.** [ADR 0017](../adrs/0017-trial-tenants-roles.md) (proposed in this PR): production becomes multi-tenant (updates
  0008); AI credentials move from firm ADMIN to Buku admin (updates 0010 §2); roles grow to four.
- **No new dependency. No AI credit use.** No accounting invariant changes: `postJournal()` and reports are untouched. The guard
  refuses a write before it reaches them. Attribution stays as in 0010 §3.
- **Deck:** `public/deck/kantor.html` line ~367 says *Hanya lewat undangan. Dua peran, Admin dan Akuntan* → update at `/ship` (trial
  request + four roles). `perusahaan.html` gains the company-organisation claim only once C1 has merged.

**Non-goals:** billing or payment; one person in several organisations (an org switcher; the session shape keeps it possible
later); Buku admins viewing or impersonating a tenant's books; per-entity permissions; Postgres RLS (the server stays the boundary,
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
6. Buku admins see metadata only, never books (client data stays private). Support access is a later, explicit feature.
7. The AI key belongs to Buku: trials spend Buku's credit, capped by a per-org monthly token budget (the trial default is the env
   default until set).
8. Four roles: OWNER / ADMIN / AKUNTAN / VIEWER, with labels *Pemilik / Admin / Akuntan / Peninjau*. AKUNTAN and VIEWER work only
   on assigned clients.
9. Supabase's custom SMTP (Resend, ADR 0010) already delivers invitations to outside addresses in production.

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
Wave 1  T01 schema ─▶ T02 permissions+grant (pure) ─▶ T03 session v2
Wave 2  T04 write guards │ T05 read scoping │ T06 backoffice shell        (after T03; T06 needs only T01)
Wave 3  T07 AI→backoffice │ T08 grants UI+CLI │ T10 trial UX │ T11 team │ T12 company UX
Wave 4  T09 signup (after T08) ─▶ T13 seed+e2e walk ─▶ T14 docs, gates, ship notes
```

## Tasks
- [ ] **T01 Schema + backfill migration.** After: none. Files: `prisma/schema.prisma`, `prisma/migrations/<ts>_trial_tenants/`,
  `lib/generated/**` (regenerated), `tests/db/tenancy-migration.test.ts`.
  `enum OrgKind { KANTOR_AKUNTAN PERUSAHAAN }` and `enum GrantKind { TRIAL PAID COMP }`. `MemberRole` gains `OWNER` and `VIEWER`.
  New `Firm` fields: `kind` (default KANTOR_AKUNTAN), `suspendedAt?`, `aiMonthlyTokenBudget Int?`, `seatLimit Int?`. Models:
  `ClientAccess { memberId, clientId, @@unique }`,
  `AccessGrant { firmId, kind, startsAt, endsAt?, note?, grantedById?, revokedAt?, revokedById?, createdAt }`,
  `PlatformAdmin { userId uuid unique, email unique, name, disabled, createdAt }`,
  `SignupRequest { email, name, orgName, orgKind, phone?, note?, status PENDING|APPROVED|REJECTED, reason?, firmId?, decidedById?, decidedAt?, ip?, createdAt }`
  and `SignupThrottle { key, windowStart, count }`. SQL backfill per M1 (COMP grant with `endsAt` null for every existing firm,
  earliest ADMIN → OWNER, AKUNTAN × clients → ClientAccess). Add a CHECK `endsAt IS NULL OR endsAt > startsAt`.
  — accept: `npm run db:migrate` on the seeded demo DB succeeds; the test asserts the backfill (grant exists, one OWNER, AKUNTAN
  assigned to all clients); all existing tests stay green.
- [ ] **T02 Permissions + access state (pure).** After: T01. Files: `lib/auth/permissions.ts`, `lib/access/grant.ts`,
  `tests/unit/permissions.test.ts`, `tests/unit/access-grant.test.ts`.
  `type Capability` (`books.read`, `books.write`, `client.create`, `period.unlock`, `import.remove`, `close.batch`, `client.delete`,
  `org.settings`, `members.manage`, `org.transfer`) and `can(role, capability)` following the Roles table. `accessState(grants, firm, now)` returns
  `{ state, endsAt, daysLeft }`, with the Jakarta end-of-day rule. `ROLE_LABEL` moves here (four labels).
  — accept: table-driven unit tests cover every role × capability and every grant edge (open-ended, revoked, future-starting,
  overlapping, ends today 23:59 WIB, suspended).
- [ ] **T03 Session v2 + client resolver.** After: T02. Files: `lib/auth/session.ts`, `lib/tenant.ts`, `tests/db/tenant-scope.test.ts`.
  `getWorkspaceSession()` also loads grants and assignments and returns `{ member, firm, access, clientIds: string[] | "ALL" }`. It returns
  null on NONE, and the `(app)` layout then sends the user to an *Akses ditutup* page (T10 styles it; T03 ships a plain one).
  `requireCapability(cap, { clientId? })` for actions throws `AccessError` (Bahasa message) on READ_ONLY writes, a missing
  capability or an unassigned client. `getClientForMember(clientId)` replaces `getClientForFirm` and keeps the old name as a deprecated
  re-export so T04 and T05 can migrate call sites in parallel. `accessibleClientWhere(session)` is the Prisma `where` used for lists.
  `requireMember(role)` maps to capabilities.
  — accept: the DB test sets up two orgs plus an assigned AKUNTAN and a VIEWER. A foreign client, an unassigned client and a READ_ONLY
  write each throw. An ADMIN resolves every client of its own org.
- [ ] **T04 Guard every write path + coverage test.** After: T03. Files: `app/actions.ts`, `app/settings-actions.ts`,
  `app/evidence-actions.ts`, `app/google-actions.ts`, `app/workspace-actions.ts`, `app/api/**`, `app/kirim/[token]/upload/route.ts`,
  `lib/controls/index.ts`, `lib/controls/history.ts` and `lib/imports/remove.ts` (role checks → `can()`), plus `tests/unit/action-guards.test.ts`.
  Each exported action calls `requireCapability` with the narrowest capability and its `clientId`. The upload route checks the
  link's organisation state. The test reads every `"use server"` file and fails on an exported async function that calls no
  `requireCapability` / `getClientForMember` / `requirePlatformAdmin`.
  — accept: guard test green; `qa-access.spec.ts` still green; a READ_ONLY org's import returns the expiry message (DB test).
- [ ] **T05 Read-path scoping.** After: T03. Files: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/work/**`,
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
  grant, extend, revokeGrant, suspend, reinstate, all writing `AuditEvent`), `app/backoffice/orgs/**`,
  `app/backoffice-actions.ts`, `scripts/access.ts` (`grant`, `revoke-grant`, `suspend`), plus `tests/db/access-admin.test.ts`.
  `createOrganisation(kind)` also creates the single client for PERUSAHAAN (reuse `createFirm`/`createClient` from `lib/setup.ts`).
  — accept: the DB test covers grant → ACTIVE, expiry → READ_ONLY, revoke → NONE, suspend → NONE, reinstate → back. Each writes an
  AuditEvent. CLI round-trip.
- [ ] **T09 Public signup + approval queue.** After: T08. Files: `app/daftar/**` (public, outside `(app)`), `proxy.ts` matcher if
  needed, `lib/signup.ts` (submit, throttle, approve, reject), `app/backoffice/requests/**`, `tests/db/signup.test.ts`, `e2e/trial-signup.spec.ts`.
  Approve = createOrganisation + TRIAL grant + `inviteUser(role OWNER)`, with compensation on failure (pattern: `inviteUser`).
  The answer is always the same and leaks nothing. Copy is Bahasa (ui-rules).
  — accept: the DB test covers the throttle (6th request in an hour refused silently), approve (org + grant + owner), reject, a
  duplicate member address refused, and a failed invite leaving no org. The e2e walk (local Supabase stack) goes request →
  backoffice approve → owner gets a password link via the admin API → lands in the workspace with the trial banner.
- [ ] **T10 Trial UX: banners, read-only, closed.** After: T03, T04. Files: `components/app/access-banner.tsx`,
  `app/(app)/layout.tsx` (banner slot only), `app/akses-ditutup/page.tsx`, the write buttons' disabled state through one
  `useAccess()` context (`components/app/access-context.tsx`), plus `e2e/trial-expiry.spec.ts`.
  — accept: the e2e test, with an org whose grant ended yesterday, can open a report and download Excel. The import button
  explains the expiry, and a forced server-action call returns the same message. With ≤ 7 days left the banner shows the count.
  Screenshots at desktop and 390 px.
- [ ] **T11 Team management (Pengaturan → Tim).** After: T03, T04. Files: `app/(app)/settings/team/**`, `app/team-actions.ts`,
  `lib/team.ts` (invite via `inviteUser`, setRole, disable/enable via `revokeUser`-style, assignClients, transferOwnership, seat
  limit), `components/app/team-table.tsx`, plus `tests/db/team.test.ts` and `e2e/roles.spec.ts`.
  — accept: the DB test proves the last OWNER cannot be demoted or disabled, an ADMIN cannot touch an OWNER, and the seat limit
  holds. The e2e test covers an OWNER inviting an AKUNTAN with one client, who sees only it, and a VIEWER who sees reports but no
  import or review buttons.
- [ ] **T12 Company organisation UX.** After: T05. Files: `app/(app)/page.tsx` (redirect branch), the `app/(app)/layout.tsx` sidebar
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

## Implementation

## Verification

## Ship Notes

## Handoffs
<!-- Cross-task requests: "T12 needs createClientAction to call requireCapability('client.create') — owner T04". -->

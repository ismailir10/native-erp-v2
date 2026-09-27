# Supabase platform: email + password login, who-did-what

## Context
Buku's login is a 6-digit email code (Resend) or a 12-digit shared code, invites are CLI-only, and a second
`ADMIN_PASSCODE` guards the AI key and Google Drive. Accountants experience three different secrets and none of them
is "my account". Nothing in the books records *who* posted, signed off, locked or imported — Rillet's promise is an
auditable close, and ours stops at "which bank row".

The database is on Neon (`main` real, `staging` demo). The user wants the platform on **Supabase, org Rightjet**,
which already holds an empty project `native-erp-v2` (`torjfwvxngzepbhswcqx`, `ap-southeast-1`, Free plan, GitHub-linked).

Outcome: an accountant opens Buku, types email + password, is in. Forgot password → one link. An invited colleague
gets an email, sets a password once, lands in the workspace. Every journal, sign-off, lock and import carries the
member who did it. Prod and staging run on Supabase Postgres + Supabase Auth; Better Auth, OTP, shared code, Resend
code delivery and `ADMIN_PASSCODE` are gone. Real data starts fresh (re-import Chickin / Goers from files after ship).

## Spec
Login (don't make me think: one screen, one primary action, specific Bahasa errors)
- [ ] `/login`: *Email*, *Kata sandi*, **Masuk** · link *Lupa kata sandi?* · wrong pair → "Email atau kata sandi
      tidak cocok." · disabled member → "Akses tidak tersedia. Hubungi pengelola Buku." · rate-limited → Supabase's
      429 mapped to "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
- [ ] `/login/lupa`: email → **Kirim tautan** → "Jika alamat ini terdaftar, tautan atur ulang masuk ke email." (never
      reveals membership). Link → `/auth/callback` → `/atur-sandi` (new + confirm, ≥ 8 chars) → workspace.
- [ ] Invitation: `npm run access -- invite --firm ID --email X --name N [--role ADMIN|AKUNTAN]` creates the Supabase
      user (`auth.admin.inviteUserByEmail`) **and** the `FirmMember`. The email link lands on `/atur-sandi`, then the
      workspace. `revoke` disables the member and ends its sessions. `list` shows members with roles.
- [ ] Session = Supabase cookie session (`@supabase/ssr`), refreshed in `proxy.ts` (Next 16), verified server-side
      with `getUser()`, resolved to an active `FirmMember` on every request. `requireWorkspaceSession()` /
      `getCurrentFirm()` keep their signatures so the rest of the app is untouched.
- [ ] Sidebar footer shows the member's name + role; **Keluar** signs out everywhere.

Roles replace the passcode
- [ ] `MemberRole` = `ADMIN | AKUNTAN`. Admin-only: AI key/model, Google Drive connect/disconnect (the actions that
      needed `ADMIN_PASSCODE`). Akuntan sees the settings read-only with "Hanya admin kantor yang dapat mengubah ini."
- [ ] `ADMIN_PASSCODE`, `AUTH_MODE`, `AUTH_SHARED_CODE`, `BETTER_AUTH_*`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM` removed
      from code, `.env.example`, README, Vercel. `SETTINGS_SECRET` stays (encrypts the AI key and Drive token).

Who did what (groundwork for an audit log)
- [ ] Nullable `…ById → FirmMember` on `JournalEntry.postedById`, `CloseSignoff.doneById`, `Period.lockedById`,
      `ControlAck.ackedById`, `StatementImport.importedById`, `LedgerImport.importedById` + `postedById`, and the
      mapping acceptance record. `postJournal()` gains an optional `actorId`; every server action passes the session
      member. Seeds / system leave null.
- [ ] Shown where the accountant already looks: journal drill ("Dicatat oleh Nama · 27 Sep 2026, 14:02" or
      "Sistem"), close panel sign-offs and lock ("oleh Nama"), import history rows. No new pages.

Platform
- [ ] Supabase Postgres is the only database in staging + production; Prisma keeps owning `public` (migrations
      unchanged in mechanism; `DATABASE_URL` = transaction pooler, `DIRECT_URL` = session pooler for migrate).
      `FirmMember.userId` is a plain `uuid` (no FK into `auth.users`), so DB tests keep running on plain Postgres.
- [ ] Two Rightjet projects: `native-erp-v2` (production, `DEMO_MODE=false`) and new `native-erp-v2-staging`
      (Vercel preview + PR branches, `DEMO_MODE=true`). Vercel gets its env from the Supabase ↔ Vercel integration
      (no secrets pass through chat); `vercel-build.sh` migrates on the non-pooling URL.
- [ ] Demo seed creates the demo admin (`DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`, staging + local only) so
      `npm run dev` → login works without a CLI step. E2E creates its users through the admin API and logs in through
      the real form; CI runs a local Supabase stack (`supabase start`, Docker) for Auth. No auth bypass anywhere.
- [ ] Docs: ADR 0010 (Supabase platform + password login), README (environment, deploy, invitation ops, branch
      workflow), `CLAUDE.md` §6, `.env.example`, `supabase/config.toml` committed.

**Gate-reopeners:** **schema migration** (drops `AuthUser/AuthSession/AuthAccount/AuthVerification/AuthRateLimit`,
adds `FirmMember` + 8 attribution columns) · **new dependencies** `@supabase/supabase-js`, `@supabase/ssr`; removes
`better-auth` · **CI change** (Supabase local stack for e2e) · **infra change** (Vercel env + integration, Neon
disconnected). No accounting invariant changes: `postJournal()` stays the only writer, amounts untouched.

**Non-goals:** team-management UI in Pengaturan (invites stay CLI this cycle); account page / change-password while
logged in (reset link covers it); Google sign-in; MFA; Row Level Security (the server is the boundary, Prisma uses
the `postgres` role); Supabase Storage for evidence; Supabase branching; migrating Neon data (fresh start by decision);
Pro plan upgrade; an audit-log page (columns land, the page is a later cycle).

**Assumptions:**
1. Rightjet `native-erp-v2` (`torjfwvxngzepbhswcqx`) is **production**; I create `native-erp-v2-staging` next to it.
   Both Free plan. Free projects pause after 7 idle days and cap at 500 MB — fine for staging, risky for a real firm.
   Upgrading Rightjet to Pro (US$25/mo) is your call, outside this cycle.
2. Neon stays untouched until production on Supabase is verified; you delete it afterwards.
3. First invited user per environment is `ADMIN` (you). Everyone else `AKUNTAN` unless `--role ADMIN`.
4. Supabase's built-in email only reaches your own org address (2/hour). Production invites to accountants need
   **custom SMTP** in the Supabase project (Resend: host `smtp.resend.com`, user `resend`, password = API key).
   You enter that in the dashboard (Authentication → Emails → SMTP); I do not handle the key.
5. Local dev = local Postgres as today + **hosted staging Auth** (`.env` points `NEXT_PUBLIC_SUPABASE_*` at the staging
   project). No Docker on this Mac, so local e2e also uses staging Auth via env; CI uses `supabase start`.
6. Attribution references `FirmMember.id`; members are disabled, never deleted, so names stay resolvable forever.
7. Password ≥ 8 characters; Supabase default session lifetime (1 h access token, refresh rotates); invite and
   recovery links valid 24 h / 1 h (Supabase defaults).
8. Cutover logs everyone out; existing staging/prod invitations are re-issued with the new CLI.
9. Installing the Supabase ↔ Vercel integration is an OAuth grant — I will stop and ask before clicking *Authorize*.

## Tasks
- [ ] T1 Infra: create `native-erp-v2-staging` in Rightjet (Free, `ap-southeast-1`); `supabase init` + `config.toml`
      (site URL, redirect URLs, password min 8, confirmations off, Bahasa templates); set the same Auth settings on both
      hosted projects via the dashboard — accept: both projects visible, Auth → URL configuration + password policy set,
      `supabase/config.toml` committed.
- [ ] T2 Schema: drop Better Auth models, add `MemberRole` + `FirmMember`, attribution columns; migration
      `supabase_members_attribution`; `lib/db.ts` reads `DATABASE_URL` / `DIRECT_URL` (fallback to the integration's
      `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`) — accept: fresh DB `prisma migrate deploy` clean; `npm test`
      green after fixture updates. Depends T1 (none for code; order only).
- [ ] T3 Auth core: `lib/supabase/{server,admin}.ts`, `proxy.ts`, `lib/auth/session.ts` (getUser → FirmMember),
      `lib/auth/operator.ts` (invite/revoke/list via admin API + FirmMember), `scripts/access.ts` `--role`, remove
      `better-auth`, OTP, shared code, Resend code mail; unit tests with a fake Supabase client — accept: lint,
      typecheck, `tests/unit/auth-*` rewritten and green. Depends T2.
- [ ] T4 Login UI: `/login`, `/login/lupa`, `/auth/callback`, `/atur-sandi`, sign-out, sidebar footer name + role;
      Bahasa copy per Spec — accept: browser walk from localhost against staging Auth: login, wrong password, forgot →
      email → set password → in, invite → set password → in, revoked → denied. Depends T3.
- [ ] T5 Roles: `requireMember("ADMIN")` in `settings-actions.ts` / `google-actions.ts`; passcode fields removed from
      `AiSettingsForm` and Drive connect; Akuntan read-only message; `ADMIN_PASSCODE` gone — accept: DB tests
      `settings-actions` updated (admin ok, akuntan denied); grep finds no `passcode`. Depends T3.
- [ ] T6 Attribution: `postJournal({ actorId })`, sign-off / ack / lock / imports / mapping record the member; UI on
      journal drill, close panel, import history — accept: DB tests assert ids; `verify:books` ALL PASS (seed = null
      actor, numbers unchanged); browser check on demo. Depends T3.
- [ ] T7 Seed + E2E + CI: demo admin in `scripts/seed.ts` / `seed-if-empty.ts`; `scripts/e2e-setup.ts` creates users
      via admin API; `e2e/*.spec.ts` log in through the form; `ci.yml` starts `supabase start -x studio,storage,
      realtime,imgproxy,edge-runtime,logflare,vector,pgadmin` and exports `supabase status -o env` — accept: `npm run
      build && npm run test:e2e` green locally (staging Auth) and CI green. Depends T4–T6.
- [ ] T8 Deploy + docs: Supabase ↔ Vercel integration (prod ↔ `native-erp-v2`, preview ↔ staging; **ask before OAuth**),
      remove Neon integration + retired env vars, `vercel-build.sh` on `POSTGRES_URL_NON_POOLING`; README, `CLAUDE.md`
      §6, `.env.example`, ADR 0010; invite you as ADMIN on staging + prod — accept: staging preview login works; prod
      login works; end-of-cycle gates green; Ship Notes filled. Depends T7.

## Implementation

## Verification

## Ship Notes

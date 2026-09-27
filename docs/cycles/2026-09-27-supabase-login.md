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
- [x] T1 Infra: create `native-erp-v2-staging` in Rightjet (Free, `ap-southeast-1`); `supabase init` + `config.toml`
      (site URL, redirect URLs, password min 8, confirmations off, Bahasa templates); set the same Auth settings on both
      hosted projects via the dashboard — accept: both projects visible, Auth → URL configuration + password policy set,
      `supabase/config.toml` committed.
- [x] T2 Schema: drop Better Auth models, add `MemberRole` + `FirmMember`, attribution columns; migration
      `supabase_members_attribution`; `lib/db.ts` reads `DATABASE_URL` / `DIRECT_URL` (fallback to the integration's
      `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`) — accept: fresh DB `prisma migrate deploy` clean; `npm test`
      green after fixture updates. Depends T1 (none for code; order only).
- [x] T3 Auth core: `lib/supabase/{server,admin}.ts`, `proxy.ts`, `lib/auth/session.ts` (getUser → FirmMember),
      `lib/auth/operator.ts` (invite/revoke/list via admin API + FirmMember), `scripts/access.ts` `--role`, remove
      `better-auth`, OTP, shared code, Resend code mail; unit tests with a fake Supabase client — accept: lint,
      typecheck, `tests/unit/auth-*` rewritten and green. Depends T2.
- [x] T4 Login UI: `/login`, `/login/lupa`, `/auth/callback`, `/atur-sandi`, sign-out, sidebar footer name + role;
      Bahasa copy per Spec — accept: browser walk from localhost against staging Auth: login, wrong password, forgot →
      email → set password → in, invite → set password → in, revoked → denied. Depends T3.
- [x] T5 Roles: `requireMember("ADMIN")` in `settings-actions.ts` / `google-actions.ts`; passcode fields removed from
      `AiSettingsForm` and Drive connect; Akuntan read-only message; `ADMIN_PASSCODE` gone — accept: DB tests
      `settings-actions` updated (admin ok, akuntan denied); grep finds no `passcode`. Depends T3.
- [x] T6 Attribution: `postJournal({ actorId })`, sign-off / ack / lock / imports / mapping record the member; UI on
      journal drill, close panel, import history — accept: DB tests assert ids; `verify:books` ALL PASS (seed = null
      actor, numbers unchanged); browser check on demo. Depends T3.
- [x] T7 Seed + E2E + CI: demo admin in `scripts/seed.ts` / `seed-if-empty.ts`; `scripts/e2e-setup.ts` creates users
      via admin API; `e2e/*.spec.ts` log in through the form; `ci.yml` starts `supabase start -x studio,storage,
      realtime,imgproxy,edge-runtime,logflare,vector,pgadmin` and exports `supabase status -o env` — accept: `npm run
      build && npm run test:e2e` green locally (staging Auth) and CI green. Depends T4–T6.
- [ ] T8 Deploy + docs: Supabase ↔ Vercel integration (prod ↔ `native-erp-v2`, preview ↔ staging; **ask before OAuth**),
      remove Neon integration + retired env vars, `vercel-build.sh` on `POSTGRES_URL_NON_POOLING`; README, `CLAUDE.md`
      §6, `.env.example`, ADR 0010; invite you as ADMIN on staging + prod — accept: staging preview login works; prod
      login works; end-of-cycle gates green; Ship Notes filled. Depends T7.

## Implementation
- Plan: T1–T8 sequential, inline (infra → schema → auth core → UI → roles → attribution → seed/e2e/CI → deploy/docs). No subagents: every slice touches the shared session/tenant layer.
- T1: Rightjet project `native-erp-v2-staging` created (`oexirgohnltkgigcteyp`, ap-southeast-1, Free, Data API off at creation). Dashboard on both projects: Site URL (prod `https://native-erp-v2.vercel.app`, staging `https://native-erp-v2-git-staging-…vercel.app`), redirect allow-list `/auth/callback` (staging also `…-git-real-data-…`, wildcard `native-erp-v2-*-…` for PR previews, `http://localhost:3000`), *Allow new users to sign up* off, min password 8, prod Data API disabled (was on). `supabase init` → `supabase/config.toml` (site_url localhost, callbacks, signup off, min 8, Bahasa invite/recovery templates in `supabase/templates/`). **Finding:** hosted templates are editable only after custom SMTP, so until then Supabase's default English template is sent; its link lands on `/auth/callback` with tokens in the URL hash — the callback must accept `code`, `token_hash` and hash flows (T4).
- T2 + T3 (one commit — the schema drop and the Better Auth removal cannot pass a gate apart): `prisma/schema.prisma` (Auth* models → `FirmMember` + `MemberRole`; `postedById`, `doneById`, `lockedById`, `ackedById`, `importedById` ×2, `LedgerImport.postedById`, `SourceAccount.mappedById`), migration `20260927032216_supabase_members_attribution` (generated with `migrate diff`, applied locally to `buku` + `buku_test`). `lib/supabase/{env,server,browser,admin,proxy}.ts`, root `proxy.ts` (Next 16 convention, refreshes the cookie session), `lib/auth.ts` (`authConfigured` = URL + publishable key present), `lib/auth/session.ts` (`getUser()` → live `FirmMember`; `requireMember(role?)` for actions), `lib/auth/operator.ts` (invite = `inviteUserByEmail` + member row; re-invite = unban + recovery link; revoke = `disabled` + 100-year ban; `ensureLocalAdmin` for demo/e2e), `scripts/access.ts` (`--role`, `--url`), `app/login/{page,login-form,actions,shell}.tsx`, `app/login/lupa`, `app/auth/callback/route.ts` (code / token_hash / hash-fragment), `app/atur-sandi` (browser client consumes the link, `updateUser({password})`), `lib/demo/admin.ts` + seeds (`DEMO_ADMIN_EMAIL/PASSWORD`, refused when `DEMO_MODE≠true`), `scripts/e2e-setup.ts` + `e2e/global-setup.ts` (admin API user, login through the real form), sidebar footer = name · role. Removed: `better-auth`, OTP/shared-code config, Resend mail, `/api/auth`, two unit tests. **Deviation:** `package-lock.json` regenerated from scratch — `npm install` of the new packages stripped rolldown's platform bindings (npm/cli#4828); a fresh lock keeps them, at the cost of patch bumps across the tree.
- T4: browser walk on localhost against staging Auth (demo admin from `DEMO_ADMIN_*`). Fixes found by the walk: the login form now keeps the typed email after an error (controlled input); `@supabase/ssr`'s browser client **forces PKCE** and rejects the hash tokens of admin-minted links ("Not a valid PKCE flow url"), so `/atur-sandi` reads `access_token` / `refresh_token` from the fragment itself (`readAuthFragment`), adopts them with `setSession`, and scrubs the hash from the address bar; link errors reported in the fragment (`error_code=otp_expired`) get the "kedaluwarsa" wording; `nativeButton={false}` on the link-styled button.
- T5: `app/settings-actions.ts` + `app/google-actions.ts` guard = `requireMember("ADMIN")` (its message is what the toast shows); `lib/settings/secret.ts` loses `adminPasscodeConfigured` / `passcodeMatches`; `app/(app)/settings/page.tsx` (Akuntan → "Hanya admin kantor yang dapat mengubah pengaturan ini…", form disabled; `canSave = admin && SETTINGS_SECRET`); `components/app/ai-settings-form.tsx` (no *Kode admin* field); `components/app/evidence-workspace.tsx` + `app/(app)/documents/page.tsx` (`isAdmin` prop: Drive connect/disconnect buttons for admins, one sentence for everyone else; error copy no longer mentions a code). Tests: `settings-actions` (admin saves, akuntan and anonymous refused), `workspace-access`, `settings`.
- T6: `PostInput.actorId` → `JournalEntry.postedById` (`lib/ledger/post.ts`, still the only writer); threaded through `postBankTransaction` opts, `reviewTransaction` / `acceptSimilar`, `postAdjustment`, `postOpening`, `postRevaluation`, `importStatement` (also `StatementImport.importedById`), `stageImport` / `postImport` (`LedgerImport.importedById` / `postedById`), `acceptMappings` (`SourceAccount.mappedById`), `lockPeriod` (`Period.lockedById`); `app/actions.ts` passes `getCurrentMember().id` (new in `lib/tenant.ts`) and records `ackedById` / `doneById`; unlock clears `lockedById`. Seeds pass nothing → null. UI: journal sheet "Dicatat oleh Nama · tanggal" (`accountLedger` row `postedBy`, `LedgerTable`), close checklist "Dicentang Nama · tanggal" and lock "… oleh Nama" (`close/page.tsx`, `ClosePanel`), import history "oleh Nama" on statements and "oleh / diunggah Nama" on ledger files. `tests/db/attribution.test.ts`.
- T7: `.github/workflows/ci.yml` — `supabase/setup-cli` + `supabase start -x realtime,storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` before `next build` (NEXT_PUBLIC_* are inlined at build), keys exported from `supabase status -o env`; `BETTER_AUTH_*` and the shared-code job removed; `APP_URL` set. `e2e/workspace.spec.ts`: wrong password keeps the email and shows the error, "Lupa kata sandi?" opens, a member logs in through the form → Beranda → Keluar → /login. Found by the run: (1) `signOut()` defaults to *global* and killed the storage-state session of the other specs → Keluar now signs out this device only (`scope: "local"`; ending every session is `access revoke`) — Spec line updated; (2) `getUser()` on every request is a round trip to Singapore, which made the evidence upload walk miss its pause window locally → `getWorkspaceSession` verifies the JWT locally with `getClaims()` (Supabase's SSR guidance) and keeps the live member check; (3) `e2e/ledger-import.spec.ts` line 120–129 raced hydration (already red on staging CI, run of 00976c9) → the Neraca Saldo click and the entity pick retry until their effect shows.
- T8 (code + docs): `scripts/bootstrap-admin.ts` (build-time: `INITIAL_FIRM_NAME` creates the first firm on an empty DB, `INITIAL_ADMIN_EMAIL` is invited once as ADMIN — no database password ever leaves Vercel/Supabase), `scripts/vercel-build.sh` (reads the integration's `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`, runs the bootstrap), `lib/db.ts` (same fallback), `.env.example` (Supabase keys, `APP_URL`, `DEMO_ADMIN_*`, `INITIAL_*`), README (quick start, environment table, Deploy = Vercel + Supabase, invitation operations, branch workflow), `CLAUDE.md` §6, `docs/real-data.md`, `docs/evidence-workspace.md`, ship skill (`.claude` and `.agents` copies are one hard-linked file), ADR 0010.
- T8 (infra): Vercel env — removed `BETTER_AUTH_URL/SECRET`, `AUTH_MODE`, `AUTH_SHARED_CODE`, `ADMIN_PASSCODE` (prod + preview) and Neon's `DATABASE_URL(_UNPOOLED)` from production (the preview copies are Neon-integration-owned and stay until that integration is removed — harmless: the build and `lib/db.ts` now prefer `POSTGRES_PRISMA_URL`). Added prod: `APP_URL`, `INITIAL_FIRM_NAME=Rightjet`, `INITIAL_ADMIN_EMAIL/NAME`; preview: `INITIAL_ADMIN_EMAIL/NAME`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` (generated, readable in the Vercel dashboard). **Deviation from assumption 9:** the Supabase ↔ Vercel integration installation on the team is bound to the *An Nisaa Sekolahku* organisation (one org per installation), so Rightjet could not be linked; instead both projects' database passwords were reset (both databases empty) and `POSTGRES_PRISMA_URL` (pooler :6543), `POSTGRES_URL_NON_POOLING` (:5432), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (legacy service_role JWT — the CLI masks the new `sb_secret_`) were set per environment via `vercel env add` from temp files, secrets marked sensitive, files deleted. Pooler host verified from here (`aws-0-ap-southeast-1`, both ports). Supabase GitHub connection on prod inspected: *Deploy to production* is off (Free plan), so it cannot push `config.toml`.

## Verification
- T1: dashboard shows both projects healthy; staging URL configuration lists 4 redirect URLs; both providers pages show signup off after reload; prod Data API page reads "Data API disabled".
- T2+T3: `npm run lint` clean; `tsc --noEmit` clean (after clearing a stale `.next/types` stub of the deleted route); `npm test` → Test Files 51 passed (51), Tests 380 passed (380). Fresh `prisma migrate deploy` on `buku_test` → "All migrations have been successfully applied."
- T4 (browser, localhost:3000 + staging Auth): wrong password → "Email atau kata sandi tidak cocok.", email kept; correct password → Beranda, footer "Admin Demo · Admin"; Keluar → /login, /documents → /login; recovery link (admin `generateLink`, resolved via curl to its `/auth/callback#access_token…` landing) → /atur-sandi with the session cookie set and the hash gone; same password → "Gunakan kata sandi yang berbeda dari sebelumnya."; new password → Beranda; `access revoke` → the live session lands on /login, login → "Akses tidak tersedia. Hubungi pengelola Buku."; /login/lupa → generic notice. `lint` clean, `tsc` clean, auth tests 2 files / 11 tests green.
- T5: `grep passcode` over app/components/lib/tests/e2e/scripts → 0 hits; `lint` clean; `tsc` clean; `npm test` → Test Files 51 passed (51), Tests 379 passed (379). Browser: /settings as ADMIN shows the form without a code field; role flipped to AKUNTAN → banner "Hanya admin kantor…", inputs disabled, footer "Admin Demo · Akuntan"; role restored.
- T6: `lint` clean; `tsc` clean; `npm test` → Test Files 52 passed (52), Tests 381 passed (381); `demo:reset` + `verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth (a first run before the reseed showed 3 August mismatches on Budi Santoso 1199/1999/3300 — hand-reviewed demo rows in the local DB, not a code change; gone after reseed). Browser on demo: Tutup Buku checklist → "Dicentang Admin Demo · 27 Sep 2026 10.59"; Buku Besar 5100 journal sheet → "Dicatat oleh Sistem · 27 Sep 2026 10.58"; Impor Mutasi history renders the "oleh" column.
- T7: `npm run build` ✓; `npm run test:e2e` (staging Auth from `.env`, `next start -p 3200`) → 10 passed (31.8s) after the three fixes above (first run: 3 failed / 7 passed, second: 2 failed / 8 passed); `lint` clean; `tsc` clean; `npm test` → Test Files 52 passed (52), Tests 381 passed (381).

## Ship Notes
- **Migration:** `20260927032216_supabase_members_attribution` drops `AuthUser/AuthSession/AuthAccount/AuthVerification/AuthRateLimit`, adds `FirmMember`, `MemberRole`, 8 attribution columns. Applied by the Vercel build on `POSTGRES_URL_NON_POOLING`. Every existing login is void: users are re-invited.
- **Env (set):** see T8 above. **Env you may still want:** production `DEMO_MODE=false` already exists; nothing else pending.
- **Manual steps for you:** (1) Custom SMTP on the production Supabase project (Authentication → Emails → SMTP, Resend: host `smtp.resend.com`, user `resend`, password = API key) — until then invitations only reach organisation-member addresses (yours works). Then paste `supabase/templates/invite.html` / `recovery.html` into Emails → Templates. (2) Optional: remove the Neon integration from the Vercel project (Storage tab) and delete the Neon project once production on Supabase is verified. (3) Optional: Rightjet → Pro before accountants rely on production (Free pauses after 7 idle days).
- **First login:** staging preview → `admin@buku.local` + `DEMO_ADMIN_PASSWORD` (Vercel → Preview env), or the invitation the build sends to `INITIAL_ADMIN_EMAIL`. Production (after staging → main promotion) → the invitation email to `INITIAL_ADMIN_EMAIL`; firm name `Rightjet` (rename via SQL if wanted).
- **Rollback:** revert the merge on `staging`; Vercel env for the old stack is gone, so a rollback also needs `DATABASE_URL` (Neon) and `BETTER_AUTH_*` restored — keep the Neon project until production is verified.

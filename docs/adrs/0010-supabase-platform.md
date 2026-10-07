# 0010 — Supabase platform: email + password login, members with roles, who-did-what

> **Staging retired by [0015](0015-production-only.md)** (2026-10-07): production is the only hosted environment; local development and e2e use a local Supabase stack.

**Context.** Login was a 6-digit email code (Resend) or a 12-digit shared code through Better Auth, invitations were CLI-only, and a
separate `ADMIN_PASSCODE` guarded the AI key and the Google Drive connection. Accountants met three different secrets and none of them
was "my account". The books recorded *which bank row* but never *who* posted, signed off, locked or imported — the auditable close
Rillet promises stops there. The database was on Neon; the owner wants the platform on Supabase (organisation Rightjet).

**Decision.**
1. **Identity = Supabase Auth, email + password.** `@supabase/ssr` cookie sessions, refreshed in `proxy.ts`, verified locally with
   `getClaims()` on every request. Forgot-password and invitation links land on `/auth/callback`, which accepts a PKCE code, a token hash
   or the fragment tokens of Supabase's default template; `/atur-sandi` sets the password and enters the workspace. Self-signup is off
   in every project; password ≥ 8 characters.
2. **Access = `FirmMember`** (`userId` = `auth.users.id` without a foreign key, firm, `role` ADMIN | AKUNTAN, `disabled`). The row is read
   live on every request, so `access revoke` closes the workspace immediately; the Supabase user is banned so no new login succeeds.
   Members are disabled, never deleted. ADMIN replaces `ADMIN_PASSCODE` for the AI credentials and Google Drive; *Keluar* ends the
   session on that device only.
3. **Who did what.** `postJournal()` takes an optional `actorId` stored as `JournalEntry.postedById`; sign-offs, control notes,
   period locks, statement and ledger imports and accepted mappings keep their member the same way. Seeds and system runs leave it
   null and read as *Sistem*. Attribution never changes amounts or posting rules — it is shown, not enforced.
4. **Supabase Postgres, Prisma still owns `public`.** Two Rightjet projects mirror git: `native-erp-v2` (production, real workspace,
   `DEMO_MODE=false`) and `native-erp-v2-staging` (every preview, synthetic). Data API is off, Row Level Security is not used — the
   server is the boundary and Prisma connects as `postgres`. Vercel gets URLs and keys from the Supabase integration; the build runs
   migrations, the demo seed and a one-time first-admin bootstrap (`INITIAL_FIRM_NAME`, `INITIAL_ADMIN_EMAIL`).
5. **Local development and CI.** Local Postgres stays; local Auth is the *staging* project's (keys in `.env`). CI boots a throwaway
   `supabase start` stack for Auth so the e2e walk logs in through the real form with a user created by the admin API. No bypass.

**Consequences.** One password per person, one invitation email, one reset link. Better Auth, Resend, `AUTH_MODE`, `AUTH_SHARED_CODE`
and `ADMIN_PASSCODE` are gone. Real data started fresh on Supabase (Neon kept until production is verified, then deleted). Invitation
emails reach addresses outside the Supabase organisation only after custom SMTP is configured on the project (Resend), where the
Bahasa templates in `supabase/templates/` are pasted. A JWT stays valid for up to an hour after a ban, but the member check makes
that irrelevant for Buku. Free-plan projects pause after a week idle and cap at 500 MB — acceptable for staging, a Pro upgrade is the
owner's call for production. Team management in the UI, an account page, Google sign-in and an audit-log page are later cycles;
the columns for the audit log already exist. Supersedes the login and environment parts of [0008](0008-one-workspace.md).

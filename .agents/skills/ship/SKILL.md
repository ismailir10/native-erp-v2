---
name: ship
description: Ship a completed Buku cycle — preflight the cycle doc, push the feature branch, open a draft PR to main using the PR template, watch CI to green. Never push to main directly.
---

# /ship

## Preflight (stop on any failure)
- All Tasks ticked; Implementation, Verification (with real gate output, incl. `verify:books` and e2e) and Ship Notes filled.
- README updated if routes, modules, env vars or setup changed.
- `git status` clean; branch is neither `staging` nor `main`.

## Steps
1. `git push -u origin <branch>` (retry network failures with backoff 2s/4s/8s/16s).
2. Open a **draft** PR to `main`; body mirrors `.github/pull_request_template.md` (Summary, Cycle doc, How to verify, Screenshots, Risks).
3. Watch CI (`.github/workflows/ci.yml`). Red → reproduce locally, fix root cause, push. No empty commits, no skipped tests.
4. When green, say so and leave merge to the user unless they said otherwise. **Merging to `main` is a production deploy** (the real
   workspace) — the only Vercel build; PR branches get no preview (`vercel.json`). GitHub deletes merged task branches automatically.
   After merge, fast-forward `main` from `origin/main`, prune remote refs, remove the merged local task branch, and verify production
   (below). Never delete `main` or `staging`.
5. `staging` is frozen (kept, no new work, no deploys). New work always starts from updated `main`.

## Deploy (when the user asks)
Vercel project `native-erp-v2` (team "Ismail's projects", slug `ismails-projects-196d40d3`) + Supabase org Rightjet (`native-erp-v2` = production, the only hosted environment, [ADR 0015](../../../docs/adrs/0015-production-only.md)).
The environment ↔ Supabase project map and the env var list are owned by [README → Deploy](../../../README.md#deploy-vercel--supabase)
and [ADR 0008](../../../docs/adrs/0008-one-workspace.md); check them, don't restate them. In short:
- **Production (git `main`) is the one real workspace** → Supabase **`native-erp-v2`**, `DEMO_MODE=false`, invitation login
  (`https://native-erp-v2.vercel.app`). Real client files live here or locally, nowhere else.
- **Preview deployments are off** (`vercel.json` → `git.deploymentEnabled` only for `main`) and there is no staging: development, CI and e2e
  run on the local Supabase stack (`npm run auth:local`). Never point dev, seeds or e2e at production.
- If a login says "Email atau kata sandi tidak cocok" for a known member, check which Supabase project the environment's
  `NEXT_PUBLIC_SUPABASE_URL` and database URL point at first (auth users and members must be in the same project).

Build: `npm run vercel-build` → `scripts/vercel-build.sh`: `prisma generate`, `prisma migrate deploy` on `POSTGRES_URL_NON_POOLING`,
seed-if-empty only when `DEMO_MODE=true`, first-admin bootstrap (`INITIAL_*`), `next build`. Schema changes ship by committing a migration.

Env vars that matter are **Production** ones; the Preview environment is unused.
- Inspect names with `vercel env ls production` (values stay hidden). The Vercel MCP can't list env vars (403); use the CLI or dashboard.
- Non-secret values (`APP_URL`, `EVIDENCE_ENABLED`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_ID`, `INITIAL_*`, `DEMO_ADMIN_EMAIL`) you may set with
  `printf %s VALUE | vercel env add NAME production`. **Secrets are set by the user or the Supabase integration** (`GOOGLE_CLIENT_SECRET`,
  `SETTINGS_SECRET`, `DEMO_ADMIN_PASSWORD`, Supabase keys and DB URLs): give them a command that pipes the value straight in.
  Secret-type vars can't be pulled back — generate or rotate instead.
- Env changes take effect only after a redeploy: `vercel redeploy <latest production URL> --target production` (ask first).
- Google OAuth (GCP project `native-erp-v2`, testing mode): the client must list the production and `localhost` `/api/google/callback` URLs, and the connecting Google account must be a test user.
- `SETTINGS_SECRET` encrypts the Drive refresh token and the Pengaturan AI key. Changing it (or pointing at a DB written under
  another secret) means reconnect Google and re-save the AI key.
- Cloud agent sandboxes may not reach Supabase (proxy) — never migrate/seed a hosted database from a sandbox; let the build do it.

Verify a production deployment: `/login` shows the email + password form (not "Akses belum siap"); the build log says
"No pending migrations to apply" or lists the new ones; Beranda shows the real firm's clients, not "KJA Demo & Rekan".
Verify an on-demand preview: run the investor walk (docs/demo/investor-demo.md) and look for "Demo data seeded/present" in the build log.

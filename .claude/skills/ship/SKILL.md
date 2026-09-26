---
name: ship
description: Ship a completed Buku cycle — preflight the cycle doc, push the feature branch, open a draft PR to staging using the PR template, watch CI to green. Never push to staging or main directly.
---

# /ship

## Preflight (stop on any failure)
- All Tasks ticked; Implementation, Verification (with real gate output, incl. `verify:books` and e2e) and Ship Notes filled.
- README updated if routes, modules, env vars or setup changed.
- `git status` clean; branch is neither `staging` nor `main`.

## Steps
1. `git push -u origin <branch>` (retry network failures with backoff 2s/4s/8s/16s).
2. Open a **draft** PR to `staging`; body mirrors `.github/pull_request_template.md` (Summary, Cycle doc, How to verify, Screenshots, Risks).
3. Watch CI (`.github/workflows/ci.yml`). Red → reproduce locally, fix root cause, push. No empty commits, no skipped tests.
4. When green, say so and leave merge to the user unless they said otherwise. GitHub deletes merged task branches automatically. After merge, switch back to `staging`, fast-forward it from `origin/staging`, prune remote refs, and remove the merged local task branch. Never delete `staging` or `main`.
5. For an authorized release, open a separate `staging` → `main` PR. Wait for CI and use a merge commit (never squash/rebase the permanent branch). Both permanent branches remain. New work always starts from updated staging.

## Deploy (when the user asks)
Vercel project `native-erp-v2` (team "Ismail's projects", slug `ismails-projects-196d40d3`) + Neon project `long-voice-58936160`.
The environment ↔ Neon branch map and the env var list are owned by [README → Deploy](../../../README.md#deploy-vercel--neon)
and [ADR 0008](../../../docs/adrs/0008-one-workspace.md); check them, don't restate them. In short:
- **Production (git `main`) is the one real workspace** → Neon branch **`real-data`**, `DEMO_MODE=false`, invitation login
  (`https://native-erp-v2.vercel.app`). Real client files live here or locally, nowhere else.
- **Preview (git `staging`, PR branches) is synthetic** → Neon branch `preview`, `DEMO_MODE=true`, invitation login + Vercel protection.
  The `native-erp-v2-git-real-data-…vercel.app` domain is a leftover name pointing at `staging`; it holds no client data.
- Neon branch `production` is a legacy demo copy that no environment should use. If a login says "Email atau kode akses tidak cocok"
  for a known invitation, check which branch `DATABASE_URL` points at first.

Build: `npm run vercel-build` → `scripts/vercel-build.sh`: `prisma generate`, `prisma migrate deploy` on `DATABASE_URL_UNPOOLED`,
seed-if-empty only when `DEMO_MODE=true`, `next build`. Schema changes ship by committing a migration.

Env vars are **per environment** — Production and Preview each need their own auth, Google and evidence settings; a var set only
for `Preview (staging)` does not exist in Production. Never copy staging secrets into production.
- Inspect names with `vercel env ls production` (values stay hidden). The Vercel MCP can't list env vars (403); use the CLI or dashboard.
- Non-secret values (`BETTER_AUTH_URL`, `AUTH_MODE`, `EVIDENCE_ENABLED`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_ID`) you may set with
  `printf %s VALUE | vercel env add NAME production`. **Secrets are set by the user** (`BETTER_AUTH_SECRET`, `AUTH_SHARED_CODE`,
  `GOOGLE_CLIENT_SECRET`, `SETTINGS_SECRET`, `ADMIN_PASSCODE`, DB URLs): give them a command that pipes the value straight in.
  Secret-type vars can't be pulled back, so a "copy from staging" pull returns nothing useful — generate or rotate instead.
- Env changes take effect only after a redeploy: `vercel redeploy <latest production URL> --target production` (ask first).
- Google OAuth (GCP project `native-erp-v2`, client "Buku Staging", testing mode): the client must list each environment's exact
  `/api/google/callback` URL, and the connecting Google account must be a test user.
- `SETTINGS_SECRET` encrypts the Drive refresh token and the Pengaturan AI key. Changing it (or pointing at a DB written under
  another secret) means reconnect Google and re-save the AI key.
- The Claude cloud sandbox cannot reach Neon (proxy blocks it) — never migrate/seed Neon from the sandbox; let the build do it.

Verify a production deployment: `/login` shows the email + 12-digit code form (not "Akses belum siap"); the build log says
"No pending migrations to apply" or lists the new ones; Beranda shows the real firm's clients, not "KJA Demo & Rekan".
Verify a preview: run the investor walk (docs/demo/investor-demo.md) and look for "Demo data seeded/present" in the build log.

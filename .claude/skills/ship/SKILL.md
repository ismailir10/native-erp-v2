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
Vercel project `native-erp-v2` (team "Ismail's projects") + Neon project `long-voice-58936160` (branch `production`).
- Vercel runs `npm run vercel-build` → `scripts/vercel-build.sh`: `prisma generate`, `prisma migrate deploy` on
  `DATABASE_URL_UNPOOLED`, seed-if-empty when `DEMO_MODE=true`, `next build`. Schema changes ship by committing a migration.
- Env: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEMO_MODE`, `SETTINGS_SECRET`, `ADMIN_PASSCODE`, `AI_BASE_URL`
  (AI key + model live in Pengaturan). From a laptop with `vercel login` the CLI can set them (`vercel env add … --sensitive`);
  the cloud sandbox token cannot. Environment ↔ Neon branch map: README → Deploy.
- Git branch `staging` = private preview for real client files (Neon `real-data`, `DEMO_MODE=false`).
- Git branch `main` = public synthetic demo (Neon `production`, `DEMO_MODE=true`). Vercel tracks `main` for Production deployments.
- Keep the existing `native-erp-v2-git-real-data-ismails-projects-196d40d3.vercel.app` domain assigned to staging; Google OAuth uses its callback. Do not move real-data environment variables to production.
- The Claude cloud sandbox cannot reach Neon (proxy blocks it) — never try to migrate/seed Neon from the sandbox; let the build do it.
- Verify a deployment: open `/`, run the investor walk (docs/demo/investor-demo.md), check build logs for "Demo data seeded/present".

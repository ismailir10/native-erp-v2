---
name: ship
description: Ship a completed Buku cycle — preflight the cycle doc, push the feature branch, open a draft PR to main using the PR template, watch CI to green. Never push to main directly.
---

# /ship

## Preflight (stop on any failure)
- All Tasks ticked; Implementation, Verification (with real gate output, incl. `verify:books` and e2e) and Ship Notes filled.
- README updated if routes, modules, env vars or setup changed.
- `git status` clean; branch is not `main`.

## Steps
1. `git push -u origin <branch>` (retry network failures with backoff 2s/4s/8s/16s).
2. Open a **draft** PR to `main`; body mirrors `.github/pull_request_template.md` (Summary, Cycle doc, How to verify, Screenshots, Risks).
3. Watch CI (`.github/workflows/ci.yml`). Red → reproduce locally, fix root cause, push. No empty commits, no skipped tests.
4. When green, say so and leave merge to the user unless they said otherwise.

## Deploy (when the user asks)
Vercel project `native-erp-v2` (team "Ismail's projects") + Neon project `long-voice-58936160` (branch `production`).
- Vercel runs `npm run vercel-build` → `scripts/vercel-build.sh`: `prisma generate`, `prisma migrate deploy` on
  `DATABASE_URL_UNPOOLED`, seed-if-empty when `DEMO_MODE=true`, `next build`. Schema changes ship by committing a migration.
- Env (set in the Vercel dashboard — the agent token cannot read/write env vars): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
  (both from the Neon integration), `DEMO_MODE`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.
- The Claude cloud sandbox cannot reach Neon (proxy blocks it) — never try to migrate/seed Neon from the sandbox; let the build do it.
- Verify a deployment: open `/`, run the investor walk (docs/demo/investor-demo.md), check build logs for "Demo data seeded/present".

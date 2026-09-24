#!/usr/bin/env bash
# Vercel build (runs instead of `npm run build` because package.json has "vercel-build").
# Vercel's build machine can reach Neon, so schema + demo data are applied here.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is not set. Connect the Neon project to this Vercel project (Storage → Connect) and redeploy." >&2
  exit 1
fi

npx prisma generate

# Migrations need a direct (unpooled) connection; the Neon integration provides DATABASE_URL_UNPOOLED.
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx prisma migrate deploy

if [ "${DEMO_MODE:-}" = "true" ]; then
  DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx tsx scripts/seed-if-empty.ts
fi

npx next build

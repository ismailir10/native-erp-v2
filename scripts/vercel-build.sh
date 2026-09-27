#!/usr/bin/env bash
# Vercel build (runs instead of `npm run build` because package.json has "vercel-build").
# Vercel's build machine can reach Supabase, so schema, demo data and the first admin are applied here.
set -euo pipefail

# The Supabase ↔ Vercel integration injects POSTGRES_PRISMA_URL (pooled) and POSTGRES_URL_NON_POOLING (direct).
# They win over a leftover DATABASE_URL from an older database integration.
export DATABASE_URL="${POSTGRES_PRISMA_URL:-${POSTGRES_URL:-${DATABASE_URL:-}}}"
DIRECT_URL="${POSTGRES_URL_NON_POOLING:-${DIRECT_URL:-$DATABASE_URL}}"
if [ -z "$DATABASE_URL" ]; then
  echo "✗ No database URL. Connect the Supabase project to this Vercel project (Integrations → Supabase) and redeploy." >&2
  exit 1
fi

npx prisma generate

# Migrations need a direct (non-pooling) connection.
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy

if [ "${DEMO_MODE:-}" = "true" ]; then
  DATABASE_URL="$DIRECT_URL" npx tsx scripts/seed-if-empty.ts
fi

# First firm + first admin from INITIAL_FIRM_NAME / INITIAL_ADMIN_EMAIL (idempotent).
DATABASE_URL="$DIRECT_URL" npx tsx scripts/bootstrap-admin.ts

npx next build

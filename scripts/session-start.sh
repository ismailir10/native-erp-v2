#!/usr/bin/env bash
# SessionStart hook (Claude Code) + manual bootstrap. Idempotent and quiet when already set up.
# Gets a fresh cloud container (or laptop) to: Postgres up → deps → migrated → demo seeded.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

# 1. Postgres: sandbox has a preinstalled cluster; laptops use docker compose.
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  if command -v su >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='buku'\"" 2>/dev/null | grep -q 1 || \
      su postgres -c "psql -qc \"CREATE USER buku WITH PASSWORD 'buku' SUPERUSER;\"" >/dev/null 2>&1
    for db in buku buku_test; do
      su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" 2>/dev/null | grep -q 1 || \
        su postgres -c "psql -qc \"CREATE DATABASE $db OWNER buku;\"" >/dev/null 2>&1
    done
  fi
elif command -v docker >/dev/null 2>&1; then
  docker compose up -d db >/dev/null 2>&1 || true
fi

# 2. Dependencies
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1 || echo "session-start: npm ci failed" >&2

# 3. Schema
npx prisma generate >/dev/null 2>&1
npx prisma migrate deploy >/dev/null 2>&1 || echo "session-start: prisma migrate deploy failed — is Postgres running?" >&2
DATABASE_URL=postgresql://buku:buku@localhost:5432/buku_test npx prisma migrate deploy >/dev/null 2>&1 || true

# 4. Demo data if empty
count=$(npx tsx -e 'import "dotenv/config"; import { createPrisma } from "./lib/db"; const db = createPrisma(); db.firm.count().then((n) => { console.log(n); return db.$disconnect(); }).catch(() => console.log("x"));' 2>/dev/null | tail -1)
if [ "$count" = "0" ]; then npm run -s demo:reset >/dev/null 2>&1 && echo "session-start: demo data seeded"; fi

echo "session-start: ready — read CLAUDE.md, then the latest docs/cycles/*.md"

#!/usr/bin/env bash
# Local Supabase Auth (ADR 0015): the same throwaway stack CI boots, so development and e2e never create accounts in production.
# Needs Docker. Starts the stack (Auth, gateway and the local mail catcher that e2e/auth-links.spec.ts reads) and writes its URL and keys
# into .env. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
# Match the app origin used by email templates (CI exports APP_URL; e2e uses port 3200).
export APP_URL="${APP_URL:-http://localhost:3000}"
SUPABASE="npx -y supabase@2.118.0" # pinned, as in CI
command -v docker >/dev/null 2>&1 || { echo "local-auth: Docker is required (docker.com, or colima on macOS)" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "local-auth: start Docker first" >&2; exit 1; }
$SUPABASE start -x realtime,storage-api,imgproxy,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null
env=$($SUPABASE status -o env)
get() { printf '%s\n' "$env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -1; }
url=$(get API_URL)
pub=$(get PUBLISHABLE_KEY); [ -n "$pub" ] || pub=$(get ANON_KEY)
sec=$(get SECRET_KEY); [ -n "$sec" ] || sec=$(get SERVICE_ROLE_KEY)
[ -n "$url" ] && [ -n "$pub" ] && [ -n "$sec" ] || { echo "local-auth: could not read the stack's URL and keys" >&2; exit 1; }
[ -f .env ] || cp .env.example .env
set_kv() { if grep -q "^$1=" .env; then sed -i.bak "s#^$1=.*#$1=$2#" .env && rm -f .env.bak; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
set_kv NEXT_PUBLIC_SUPABASE_URL "$url"
set_kv NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$pub"
set_kv SUPABASE_SECRET_KEY "$sec"
echo "local-auth: Supabase Auth at $url (local only); .env updated. Stop it with: npx supabase@2.118.0 stop"

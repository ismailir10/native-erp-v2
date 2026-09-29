# Main-only workflow and production-only Vercel builds

## Context
A staging branch between task PRs and production doubled the release work and every PR or push built a Vercel preview,
spending the build allowance. Decision (owner, 2026-09-29): merge task branches straight to `main`; build on Vercel only
when `main` changes; keep `staging` frozen and the synthetic Supabase staging project for local-dev Auth and e2e.

## Spec
- [x] `vercel.json` enables Git deployments for `main` only (`"**": false, "main": true`; Vercel deploys when any matching rule is true).
- [x] CI runs on every pull request and on pushes to `main` (no longer `staging`).
- [x] AGENTS.md, the ship skill, README (Deploy, Branch workflow) and docs/real-data.md describe the main-only flow.
- [x] GitHub default branch = `main` (repository setting, after the last staging → main release merged).

**Non-goals:** deleting the `staging` branch, the Preview environment variables or the `native-erp-v2-staging` Supabase project.
**Assumptions:** on-demand previews (`vercel deploy`) stay possible and are used only when asked.

## Tasks
- [x] T1 Config + docs — accept: `vercel.json` parses; no process doc tells new work to start from or target `staging`.

## Implementation
- T1: vercel.json, .github/workflows/ci.yml, AGENTS.md, .agents/skills/ship/SKILL.md, README.md, docs/real-data.md.

## Verification
- `vercel.json` parses as JSON; the PR itself gets no Vercel preview build; its merge produces one production deployment.

## Ship Notes
- No migrations, no env vars. Manual: GitHub default branch set to `main`.
- Rollback: revert this commit (previews return on the next push).

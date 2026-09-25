# Staging-first branch workflow

## Context
The user requests exactly two permanent repository branches (`staging` and `main`), staging as the default, and automatic deletion of merged PR task branches. The repo default was an old feature branch and retained seven merged PR branches.

## Spec
- [x] Rename real-data to staging and retain main for production; default to staging remotely and locally.
- [x] Enable automatic deletion of merged task branches; protect both permanent branches from deletion and force-push, with CI required.
- [x] Remove only verified merged branches, retaining a recovery bundle locally.
- [x] Move Vercel branch settings and private environment scopes while preserving databases, secrets and the existing OAuth callback domain.
- [ ] Run CI on staging and main; update contributor and ship instructions; prove task branch deletion through this PR.
**Authorization:** User explicitly requested the branch workflow change; prior delivery authorization covers testing and merge.
**Non-goals:** Application behavior, schema, dependencies, paid AI, database migration or credential rotation.
**Assumptions:** “Only staging and production” means permanent branches; active PRs may have temporary task branches. Production releases use a separate staging-to-main PR.

## Tasks
- [x] T1 Repository and deployment settings — accept: staging default, auto-delete enabled, only two permanent branches, environment scopes and callback preserved.
- [x] T2 CI and operating instructions — accept: CI covers both permanent branches; contributor guidance defaults to staging and defines promotion; local verification passes. Merge and deployment results are recorded in the delivery PR.

## Implementation
- Final naming: the user clarified that production must use `main`; `staging` remains default.
- Plan: T1–T2 sequential, handled inline because repo settings, deployment configuration and branch lifecycle must agree.
- Verified all seven PR head SHAs match their merged branch tips; the old default was an ancestor of production. Saved a Git bundle before pruning.
- Renamed branches through GitHub, enabled delete_branch_on_merge, protected both branches, moved eight private environment variable scopes without reading/changing their values, and bound the existing callback domain to staging.
- CI push filters now include staging and main; ship guidance defaults task PRs to staging and uses merge commits for production promotion.

## Verification
- GitHub API: staging default, automatic deletion enabled; staging/main protected and require check.
- Vercel API: production branch is main; eight former real-data environment scopes moved to staging; existing callback domain verified and assigned to staging.
- Local lint/typecheck passed; 35 Vitest files / 261 tests passed in 44.39s. Initial sandbox DB access failed before tests; reran with local database access.
- Production build passed (webpack fallback; no config changes). Full CI and live Chrome results are recorded in the delivery PR.
- Local accounting verification: ALL PASS (1,333 checks). Public E2E: 4 passed; private evidence E2E: 2 passed. Tests used a disposable local database and mocked AI.

## Ship Notes
- No app, schema, dependency, secret value or database changes. Neon real-data remains private; production remains synthetic.
- Rollback branch names only after restoring matching Vercel branch scopes and production tracking. Recovery bundle retained locally; no source data deleted.

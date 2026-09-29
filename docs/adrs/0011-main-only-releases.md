# 0011 — Merge to main directly; Vercel builds production only

**Context.** [0008](0008-one-workspace.md) made staging a deployed, synthetic pre-production: task PRs merged into `staging`, and a
separate `staging` → `main` PR with a staging smoke test promoted each release. With one developer that doubled every release, and
Vercel built a preview for every PR push and every staging merge, spending the build allowance on environments nobody opened.

**Decision.**
- Task branches (`task/<slug>`) start from `main` and their PRs target `main`. A merge is the production release.
- CI on every PR (lint, typecheck, tests, build, `verify:books`, e2e against a local Supabase stack) is the release gate. There is no
  staging smoke test.
- `vercel.json` enables Git deployments for `main` only. PR and other branches build no preview; a preview is built on demand with
  `vercel deploy` when asked.
- Git branch `staging` is frozen (kept, protected, no new work). The Supabase project `native-erp-v2-staging` stays synthetic and
  backs local-development Auth, laptop e2e and on-demand previews.

**Consequences.** Every merge ships to the real client books, so a red CI blocks the merge and a bad release is reverted on `main`.
Supersedes the staging pre-production and promotion parts of [0008](0008-one-workspace.md); production as the one real workspace,
and the real-data rules, are unchanged.

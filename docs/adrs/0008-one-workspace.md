# 0008 — One workspace: production is the real firm

**Context.** Production (`main`) was a synthetic public demo that linked to a separate "ruang kerja privat" on the protected staging preview, where real client files lived. Accountants therefore had two places to go, and the product shown to them was not the product they worked in. Since [workspace-auth](../cycles/2026-09-25-workspace-auth.md), both environments require invitation-only login and run the same screens.

**Decision.**
- Production is the single real workspace. It uses the Neon branch that already holds the firm's real work, has `DEMO_MODE=false`, and is the only place invited accountants are sent.
- Staging is pre-production. It runs the same code on a synthetic database (`DEMO_MODE=true`) behind Vercel protection and invitation login. It is used to test a release before promotion, not to hold client work.
- The synthetic demo firm exists only locally, in CI and on staging. The public demo UI (and its link to a private workspace) is removed.
- Real-data rules still apply: files never go into Git, `data/private/` stays local, and tests and seeds never call a paid model. The operator reset (`demo:reset`) must never be pointed at the production database.

**Consequences.** One URL for users. Promotion to `main` now ships to real client books, so the staging → main merge requires green CI, `verify:books`, and a staging smoke test first. Google OAuth for Drive must list the production callback URL. Supersedes the environment split in [0007](0007-evidence-workspace.md) ("pilot gated to local/protected preview") and the production row of the README deploy table.

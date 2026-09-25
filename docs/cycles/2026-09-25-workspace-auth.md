# Shared accounting workspace and invitation-only access

## Context
The user requested self-review against Don't Make Me Think and explicitly chose “Continue into production UI + login” after prototype fixes. Bring the reviewed dashboard and invitation-only experience into the application, retaining the existing accounting workflows and controls.

## Spec
- [x] Protect all workspace pages, actions, document sources, settings, and integrations with a verified session; resolve firm from that session.
- [x] Invitation-only email-code login, operator-managed invitations and revocation, no public signup or roles. Every invited user shares their firm's workspace.
- [x] Use Better Auth with Prisma-backed sessions, hashed short-lived OTPs, bounded attempts and database rate limiting. Add its dependency and auth migration. Send codes through a configured email provider; no real emails or paid AI during tests.
- [x] Beranda prominently hosts Tanya Buku with visible client/group/company and period context. Navigation is Beranda, Pekerjaan, Dokumen, Laporan; existing accounting routes remain reachable.
- [x] Shared URL scope and period survive navigation. Server validates entity/client ownership. Answers retain the original scope/period and source links.
- [x] Dashboard and Pekerjaan prioritize actual review/close blockers; reports derive from existing ledger functions, preserve currencies and distinguish absent data from zero. All-client financial comparisons are not consolidation.
- [x] Portfolio questions use bounded deterministic read tools for supported accounting questions and document evidence. Unsupported requests say so; no invented answers or unrestricted SQL.
- [x] Same protected application screens in staging and main; remove public-demo-only document UI divergence without exposing private evidence to anonymous users. Separate environment credentials/data remain.
- [x] Verify authorization, invitation/revocation, OTP/session behavior, scope isolation, report correctness, keyboard use, 390px layout, and full repository gates.

**Approval:** User explicitly authorized continuing into production UI and login after self-review on 2026-09-25. This is the implementation scope of that instruction; no additional approval is required for routine reversible implementation.
**Gate reopeners included:** Better Auth dependency and auth-only schema migration. Accounting invariants, posting rules, and paid-AI budgets remain unchanged.
**Non-goals:** deployment or merging without request, real invitations/messages, real client uploads, schema changes to accounting, formal cross-client consolidation, new user roles.
**Assumptions:** Operator provisions accounts through an authenticated local administrative CLI; no in-app roles/invitation UI. Email delivery uses environment configuration. Environment setup is documented and tested with mocks; no secrets are generated or sent to external services during this task.

## Tasks
- [x] T1 Access — Better Auth, login, operator CLI, session tenancy, tests and migration.
- [x] T2 Scoped read model — validated shared scope, period, portfolio summaries and cited deterministic questions.
- [x] T3 Workspace — dashboard Ask Buku, four destinations, clear next actions, context-preserving navigation and answer history.
- [x] T4 Integration and verification — same screens across environments, all access boundaries, README/setup/E2E updates, full gates and draft PR.

## Implementation
- Plan: T1, T2, and T3 delegated as independent slices with explicit file ownership and contracts; T4 integrated and reviewed by the driver. Build skill permits independent fully-specified delegation. No production data or services are mutated.

- T1: Added invitation-only Better Auth sessions, hashed five-minute email codes, attempt and persistent delivery limits, exact-origin checks, live revocation, and explicit firm tenancy. Operator CLI provisions/revokes access without sending messages. The additive migration contains only authentication tables and their firm relation.

- T2: Added server-validated all/client/company scope and period, ledger-derived financial summaries, real close blockers, and bounded deterministic questions with immutable context and source citations. Each company retains its currency; uploaded figures remain evidence. Scoped bulk review cannot accept another company’s or a future period’s transactions. Tests cover foreign-firm IDs, exact bigint amounts, mixed currencies, missing data, source citations and company context.

- T3: Replaced the dashboard with visible Tanya Buku, four main destinations, shared scope/period, prioritized work, close progress and company financials. History remains in memory across navigation; cited answers retain their submission context. Simplified secondary navigation and made logout available on mobile. Self-review fixed heading semantics and moved the keyboard skip link before the sidebar.

- T4: Unified protected document screens across environments, guarded settings/integration actions, removed online database reset, preserved source-to-question context, and limited review to its selected entities and cutoff. Added real-session E2E setup with a captured mail transport, updated CI to exercise both modes, and documented provisioning and rollout. [Self-review and screenshots](../reviews/2026-09-25-workspace/README.md) record the UX findings and fixes.

## Verification
- Integrated T1–T3 gate: lint and typecheck passed; Vitest reported `Test Files 42 passed (42)` and `Tests 291 passed (291)`. Authentication tests cover unknown addresses, code hashing/expiry/reuse, rate limits across instances, revocation, disabled users, forbidden origins and logout. Mail delivery is mocked.

- Final lint/typecheck: passed after the keyboard fix. Production build: passed, including `/login`, `/api/auth/[...all]`, `/work` and `/reports`.
- Local migration applied to the disposable `buku_workspace_20260925` database; no remote database was used.
- Books verification: `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`
- Full browser suite, demo mode on: `8 passed (39.1s)`. Full suite with demo mode off, using normal file upload: `8 passed (34.0s)`.
- Browser coverage includes uploads/citations, review → ledger → report → close, imported ledgers and FX, opening balances and password-protected PDF, anonymous redirects, invitation-only login errors, persistent scope/period/answer context, keyboard skip navigation, and 390px layout.
- Inspected desktop/mobile screenshots. Corrected a misplaced skip link and missing heading semantics. One earlier run could not write a trace because the local disk was full; removed only generated build cache and reran successfully. Updated the investor test to use normal upload so it works without the demo sample shortcut.
- `git diff --check`: passed. Real email and paid AI were not called. Mail is mocked; seeded accounting uses the existing MockProvider.

## Ship Notes
- Migration: `20260925120000_invitation_auth` adds authentication tables and a firm relation. Accounting tables, posting rules and existing entries are unchanged.
- Required per environment: `BETTER_AUTH_URL`, a unique random `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, and verified `AUTH_EMAIL_FROM`; enable the same document workspace with `EVIDENCE_ENABLED=true`.
- Before rollout: apply the additive migration through the normal deployment, use the operator CLI to provision at least one account for that environment, and verify code delivery with its configured sender. Do not copy staging users, sources, secrets or databases into main.
- Shared UI has no database-reset action. Local `demo:reset` is destructive operator tooling and removes invitations/sessions too; re-provision synthetic users afterward.
- No deployment, merge, real email, paid AI request or real-client mutation was performed. PR creation follows the repository's draft-to-staging workflow; preview automation remains managed by the repository.
- Rollback: keep external access protection in place, revert the application changes as needed, and retain the additive auth tables. Do not expose the previous anonymous application when rolling back access controls.
- Limits: portfolio questions use bounded deterministic tools; no general autonomous agent or formal portfolio consolidation. Answer history is memory-only. Real provider delivery remains a rollout check.


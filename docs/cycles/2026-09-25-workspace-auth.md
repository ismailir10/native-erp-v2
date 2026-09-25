# Shared accounting workspace and invitation-only access

## Context
The user requested self-review against Don't Make Me Think and explicitly chose “Continue into production UI + login” after prototype fixes. Bring the reviewed dashboard and invitation-only experience into the application, retaining the existing accounting workflows and controls.

## Spec
- [ ] Protect all workspace pages, actions, document sources, settings, and integrations with a verified session; resolve firm from that session.
- [ ] Invitation-only email-code login, operator-managed invitations and revocation, no public signup or roles. Every invited user shares their firm's workspace.
- [ ] Use Better Auth with Prisma-backed sessions, hashed short-lived OTPs, bounded attempts and database rate limiting. Add its dependency and auth migration. Send codes through a configured email provider; no real emails or paid AI during tests.
- [ ] Beranda prominently hosts Tanya Buku with visible client/group/company and period context. Navigation is Beranda, Pekerjaan, Dokumen, Laporan; existing accounting routes remain reachable.
- [ ] Shared URL scope and period survive navigation. Server validates entity/client ownership. Answers retain the original scope/period and source links.
- [ ] Dashboard and Pekerjaan prioritize actual review/close blockers; reports derive from existing ledger functions, preserve currencies and distinguish absent data from zero. All-client financial comparisons are not consolidation.
- [ ] Portfolio questions use bounded deterministic read tools for supported accounting questions and document evidence. Unsupported requests say so; no invented answers or unrestricted SQL.
- [ ] Same protected application screens in staging and main; remove public-demo-only document UI divergence without exposing private evidence to anonymous users. Separate environment credentials/data remain.
- [ ] Verify authorization, invitation/revocation, OTP/session behavior, scope isolation, report correctness, keyboard use, 390px layout, and full repository gates.

**Approval:** User explicitly authorized continuing into production UI and login after self-review on 2026-09-25. This is the implementation scope of that instruction; no additional approval is required for routine reversible implementation.
**Gate reopeners included:** Better Auth dependency and auth-only schema migration. Accounting invariants, posting rules, and paid-AI budgets remain unchanged.
**Non-goals:** deployment or merging without request, real invitations/messages, real client uploads, schema changes to accounting, formal cross-client consolidation, new user roles.
**Assumptions:** Operator provisions accounts through an authenticated local administrative CLI; no in-app roles/invitation UI. Email delivery uses environment configuration. Environment setup is documented and tested with mocks; no secrets are generated or sent to external services during this task.

## Tasks
- [x] T1 Access — Better Auth, login, operator CLI, session tenancy, tests and migration.
- [x] T2 Scoped read model — validated shared scope, period, portfolio summaries and cited deterministic questions.
- [x] T3 Workspace — dashboard Ask Buku, four destinations, clear next actions, context-preserving navigation and answer history.
- [ ] T4 Integration and verification — same screens across environments, all access boundaries, README/setup/E2E updates, full gates and draft PR.

## Implementation
- Plan: T1, T2, and T3 delegated as independent slices with explicit file ownership and contracts; T4 integrated and reviewed by the driver. Build skill permits independent fully-specified delegation. No production data or services are mutated.

- T1: Added invitation-only Better Auth sessions, hashed five-minute email codes, attempt and persistent delivery limits, exact-origin checks, live revocation, and explicit firm tenancy. Operator CLI provisions/revokes access without sending messages. The additive migration contains only authentication tables and their firm relation.

- T2: Added server-validated all/client/company scope and period, ledger-derived financial summaries, real close blockers, and bounded deterministic questions with immutable context and source citations. Each company retains its currency; uploaded figures remain evidence. Scoped bulk review cannot accept another company’s or a future period’s transactions. Tests cover foreign-firm IDs, exact bigint amounts, mixed currencies, missing data, source citations and company context.

- T3: Replaced the dashboard with visible Tanya Buku, four main destinations, shared scope/period, prioritized work, close progress and company financials. History remains in memory across navigation; cited answers retain their submission context. Simplified secondary navigation and made logout available on mobile. Self-review fixed heading semantics and moved the keyboard skip link before the sidebar.

## Verification
- Integrated T1–T3 gate: lint and typecheck passed; Vitest reported `Test Files 42 passed (42)` and `Tests 291 passed (291)`. Authentication tests cover unknown addresses, code hashing/expiry/reuse, rate limits across instances, revocation, disabled users, forbidden origins and logout. Mail delivery is mocked.

## Ship Notes


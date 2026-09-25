# Architecture and workspace review prototype

## Context
The user approved a documentation and standalone HTML prototype phase: explain Buku beyond bank imports, emphasize its own general ledger, and review a dashboard-first interface before implementing production UX or authentication.

## Spec
- [x] README introduces the full input range and an editable, accessible product architecture diagram.
- [x] Architecture centers the General Ledger beside Document Evidence and Company Context, beneath Buku intelligence and the three user experiences.
- [x] Clearly distinguish current behavior, target UX, source-reported figures, and ledger-derived reports.
- [x] Standalone Bahasa HTML prototype demonstrates shared scope/period, cited questions, all input categories, and review → ledger → report → close.
- [x] Simulate invite-only email-code login with no roles or network requests.
- [x] Verify desktop, keyboard use, mobile at 390px, and coherent synthetic accounting values.

**Approval:** User explicitly requested implementation of the complete plan in this task.
**Non-goals:** production code, real authentication, schema changes, private data, paid AI, deployment, always-on agents, formal consolidation.
**Assumptions:** All prototype data is invented; workspace state lives only in browser memory. Scope and period remain in the URL. No user invitations are sent.

## Tasks
- [x] T1 README and architecture — accept: full input story, explicit ledger core, accessible SVG.
- [x] T2 Standalone prototype — accept: complete synthetic review journey and scoped cited questions.
- [x] T3 Verification and review handoff — accept: browser checks and documented results.

## Implementation
Documentation-only work on `codex/buku-architecture-prototype`. The existing production application and its dependencies are unchanged.

- Added a four-layer SVG with editable text and an accessible description. General Ledger is the central accounting foundation, distinct from document evidence and company context.
- Rewrote the README opening, explained five input categories and limits, and separated existing functionality from the proposed experience.
- Built one offline HTML file with inline CSS, JavaScript, and icons. Synthetic journals feed reports using bigint arithmetic; source figures are independent of review state. Questions preserve their original context and values.
- Added a review guide covering the end-to-end journey and prototype boundaries. No runtime dependencies, schema migrations, external calls, or real authentication were added.

## Verification
- `npm run lint` and `npm run typecheck`: passed.
- `npm test`: 35 files / 261 tests passed. Sandbox initially blocked localhost DB access; rerun against explicit disposable local `buku_test` passed. No production DB was used.
- SVG XML parsing, inline JavaScript syntax check, and `git diff --check`: passed.
- Temporary Node assertions checked every journal and the accounting equation for all companies, both populated periods, both review states, and both expense-account choices. Nusa profit moves from Rp 38,000,000 to Rp 35,600,000; cash stays Rp 135,600,000; suspense becomes zero. Source-reported profit stays Rp 35,600,000.
- In-app browser, desktop: invitation simulation, wrong-code error, portfolio → group → company scope, historic answer labels, citations, review → preserved bank journal + reclassification → report → sign-off → closed status.
- In-app browser, 390px: login, dashboard, all five document previews, filters, empty September, and corrected period-selector width. Page width is 390px; each source panel's content width equals its 389px client width (no horizontal overflow).
- Keyboard: Shift+Tab wraps within review dialog; Escape restores focus to its opening button.
- Product architecture inspected in browser at desktop width, including all source labels and trust strip. Full production build/accounting/E2E gates are delegated to PR CI for this docs-only change; local verification focused on the new offline artifact plus existing lint/typecheck/tests.

## Ship Notes
Deliver as a documentation-only draft PR to staging. No merge or production deployment is part of this task. Open the local HTML for review; example email is prefilled and the simulated code is `123456`.

Production UX and invitation-only authentication follow prototype feedback. Reverting the documentation commits removes the artifacts without affecting application data or behavior.

# Public site: product evidence, trial access, Terms and Privacy

## Context

A signed-out visitor currently reaches a login form at Buku's home address. The product has two audience-specific
decks and a trial-request form, but no public page that explains the offer and demonstrates the real software.
Terms and Privacy are also prerequisites for the first external trial in the preceding access cycle.

The audience is an Indonesian accounting firm choosing software, a company choosing how its books are prepared,
and a startup-program reviewer assessing a working business. The intended outcome is a credible public product
surface: Rekening Koran in, laporan keuangan out, with every bank-derived figure traceable to its source row.
An accountant still reviews uncertain suggestions and decides when the books can close.

The prerequisite access PR is merged. This cycle starts from the latest main on task/public-site. This record is
the spec only; implementation begins after the owner's approval. The owner explicitly requested a draft PR for
this spec before that approval.

## Spec

### Decisions

1. Lead with the accounting workflow and real product evidence. Two plainly labelled audience sections reuse the
   checked deck story; they do not invent benefits or turn the site into a generic feature-card grid.
2. Publish captured product screenshots rather than connecting a public visitor to a live workspace. Capture them
   from the local synthetic demo through the real app, and make regeneration repeatable. No real client data is
   read or exposed. Each image is visibly identified as synthetic demonstration data.
3. Extend the existing public shell, branding, typography and metadata. The landing page and both legal pages
   share a public header and footer; login and the trial form share those legal destinations. Preserve the auth
   form's familiar presentation and the scanner-safe email confirmation flow.
4. Keep existing session and tenant rules. An accounting-firm member sees Beranda, a company member keeps its
   own-books destination, and a Buku admin without an active support session goes to Backoffice. A live support
   session retains its existing read-only workspace view. No permission is widened to make the public page work.
5. Describe actual data handling in plain Bahasa. Legal wording remains visibly marked draf until the owner
   confirms it. No automatic-deletion schedule, provider training guarantee or legal certification is invented.
6. Application credibility means a coherent, finished product story, usable trial request, product evidence,
   accessible mobile pages and transparent data handling. The owner-linked startup program accepts bootstrapped
   applicants; its application is behind Console sign-in, so private eligibility fields were not verified.
   Program acceptance, credits, funding, customer traction and provider adoption are not public claims.

### Acceptance criteria

- [ ] **Public home and session routing.** Signed-out `/` returns the landing page without redirecting to login.
  A signed-in accounting-firm member still gets Beranda, including its existing scope and period links. Company,
  Buku-admin, live-support, expired-trial, disabled-member and closed-access behavior follows the decisions above
  and the existing access rules. Protected routes still require a member session. No authenticated response or
  workspace data is cached as public landing content. A deployment without login configuration still shows the
  public landing and legal pages.
- [ ] **Shared public frame.** Landing, `/syarat` and `/kebijakan-privasi` have the same linked Buku logo, header
  actions Masuk and Minta uji coba, and footer links Syarat, Privasi and contact. The header's trial link and the
  landing's primary Minta akses uji coba action reach `/daftar`. The secondary deck action reaches `/deck`.
  Login and the trial form expose both legal links. Navigation stays visible and usable at 390 px.
- [ ] **One truthful promise, two audiences.** Bahasa uses Rekening Koran, Buku Besar, Neraca Saldo, Laba Rugi,
  Neraca and Tutup Buku. It explains the accountant's review and traceability, not autonomous accounting.
  Kantor akuntan copy explains handling multiple clients; perusahaan copy explains the company's own books and
  the accountant's role. Claims reuse the current decks: uploaded bank files, review, source traceability,
  close controls and Excel/PDF reports. Bank names, format combinations and any coverage count are backed by the
  registry and fixture coverage; recognition of a bank does not mean every format from it is supported.
- [ ] **Real product shown in every product section.** The landing includes at least (a) a bank row and its
  actual related journal, with matching amount and source reference; (b) Neraca Saldo with real demo totals;
  (c) the close checklist with its actual blockers and passed checks. Each product section includes a genuine
  screen or a verified number from the synthetic demo. The audience section pairs its copy with product proof.
  Legal pages and navigation are reading/navigation surfaces, not places to add decorative metrics.
- [ ] **Regenerable, legible images.** A documented local capture command regenerates the three views from
  KJA Demo & Rekan at a pinned scope and period. It refuses hosted targets, uses the existing demo login, waits
  for stable content/fonts, and never needs real model calls. Optimised images have descriptive Bahasa alt
  text, intrinsic sizes, responsive sizing, and lazy loading below the fold. The key evidence remains readable
  on a phone, using a useful crop/detail image where a full desktop table would become too small. The public
  site serves saved assets and never queries demo books on a visitor's behalf.
- [ ] **Terms and Privacy are readable drafts.** Both pages have a top-of-page draf notice, a readable date,
  short labelled sections and the same contact destination. Together, and with shared support/trial sections
  on each page, they cover:
  - Trial-request name, work email, organisation, organisation kind, optional WhatsApp and note, plus IP for
    abuse prevention/rate limiting; required versus optional fields; review/contact purposes; request records
    and throttle records as distinct data.
  - Retention stated honestly: there is no scheduled purge today. Request and throttle records remain until
    an authorised deletion is carried out; the one-hour rate-limit window does not delete stored records.
    Workspace data is not automatically deleted at trial expiry. Rights requests are handled through contact,
    with applicable legal-retention limits explained, without promising an unimplemented deletion feature.
  - Trial approval by Buku, access dates, and read/export access after expiry with writes and AI unavailable.
    Revocation or suspension can close access; an expired trial is not a promise of perpetual access.
  - Support staff can open a workspace read-only for troubleshooting, for up to 60 minutes, after two-step
    login and with a recorded reason. The organisation is not notified each time. Buku logs sessions, pages
    and downloads; the log is held by Buku rather than shown as the organisation's activity.
  - Task-specific AI processing: classification sends limited descriptions, direction and client/account
    context, not transaction amount/balance fields; account mapping sends source-account names/context;
    evidence questions/analysis can send bounded document passages; close explanations can send flagged
    rows and amounts; management commentary sends computed narrative facts. Scan reading is off unless Buku
    enables it, and when used it sends page images, which can contain personal and financial data. No blanket
    claim that financial amounts or account identifiers never reach a provider. AI proposes; people approve.
  - Application/database location in Singapore, as stated in the decks, distinguished from third-party AI
    processing. Do not imply all third-party processing remains in Singapore or promise provider retention
    terms that were not verified. Explain applicable UU PDP rights, purposes, processing grounds, correction,
    access, withdrawal/objection and deletion requests, and contact without claiming certified compliance.
- [ ] **Contact and consent.** Server-rendered public contact reads the configured support email and offers a
  working mailto link when valid. Otherwise show the neutral Hubungi pengelola Buku fallback; no invented
  address. Under the trial submit button, a visible Bahasa consent line links Syarat and Privasi, explains
  processing the request, and does not claim a consent record is stored. Pending, field-error and thank-you
  states stay accessible and preserve the current non-enumerating response behavior.
- [ ] **Auth emails.** Every checked-in auth/security email includes Buku-origin links to Syarat and Privasi.
  The invitation, recovery and confirmation actions keep their existing destination and scanner-safe behavior.
  The generated hosted payload preserves the legal links and the support-footer marker behavior. Hosted
  template configuration is not applied during this cycle.
- [ ] **Motion proposal: existing pieces only.** Reuse `.page-settle` for arrival on public content and auth
  cards. Retain `DotGrid` on auth pages only, because that is its approved scope. `CountUp`, `CheckDraw` and
  `ProgressFill` remain in the genuine product components captured for evidence; screenshots are static and
  public figures do not animate. No new React Bits piece, scroll reveal or animated list is proposed. Any
  public arrival motion plays once, lasts no more than 450 ms, eases out, never animates table rows or inputs,
  and is disabled with prefers-reduced-motion. Existing licences stay intact.
- [ ] **Anti-slop screenshot review.** At both 1440 and 390 px, verify all of these:
  - No purple/decorative gradients, emoji, sparkle/magic-wand icons, hype such as revolusioner or powered by AI.
  - No stock illustrations, fake logos, testimonials, customer counts, speed/savings claims or traction metrics.
  - No three identical icon cards in a row; product sections carry real screenshots or verified demo numbers.
  - Existing Hanken Grotesk and colour tokens: warm grey canvas, near-black ink, one strong blue for actions.
  - No glass, glow/star borders, spotlight/tilt/magnet cards, cursor effects, 3D, click sparks, animated
    aurora/plasma/silk/beams/particle backgrounds, or gradient/shiny/glitch/decrypt text.
  - Clear hierarchy, useful screenshots and deliberate whitespace; no vendor names on any public page.
- [ ] **Performance and accessibility.** Mobile Lighthouse performance and accessibility each reach 95 or
  higher for landing and both legal pages on a production build, with the report and run settings recorded.
  No horizontal page scroll at 390 px; keyboard-visible focus, skip navigation, semantic landmarks, one h1,
  correct headings and labelled form controls. Verify screen-reader reading order and image descriptions.
  Page-specific metadata, canonical public URLs, a working Open Graph image, favicon and Bahasa document
  language are present. The trial form/login get the same keyboard, overflow and screenshot review.
- [ ] **Evidence and deck consistency.** Capture and inspect landing, Terms, Privacy, login and trial form at
  1440 and 390 px; capture the trial thank-you state too. Record anti-slop review findings and fixes, Lighthouse
  scores, and local flow evidence for the final runtime commit. Deck claims to compare are uploaded bank
  formats/coverage, review versus automatic posting, traceability, close checks, audience/roles, Singapore
  hosting and Data dan AI. No deck changes unless the landing changes a claim; if it does, update both relevant
  decks and regenerate their PDFs in this cycle.

### Verify flows

1. **New prospect, desktop and phone.** Signed out, open home → inspect the three product views and audience
   copy → open deck → request trial → read both legal pages → submit synthetic contact details. Expect a clear
   thank-you state, no automatic account creation, working footer/header links and no horizontal scroll.
2. **Existing users.** Sign in as the demo firm member → home is Beranda → preserve scope/period across
   navigation. Repeat with a company member and a Buku admin; verify their existing destinations and an active
   read-only support session. A signed-out protected route still reaches login; foreign-tenant access is refused.
3. **Access edge cases.** An expired-trial member can read/export but cannot write or call AI. Closed access
   keeps its closed-access destination. Without auth configuration, a visitor can still read public pages;
   without a valid support address, the neutral fallback appears. Reduced motion removes public animation.
4. **Form/error case and email.** Keyboard-only visitor submits invalid email/missing required fields, corrects
   them, then submits. Errors are labelled and entered values stay. Duplicate/throttled requests keep the same
   acknowledgement. Inspect a locally captured invitation and recovery email, open each legal link, then
   confirm its existing authentication action still works.

### UX notes

The first view says what Buku does, who it serves and what to do next, beside real product evidence. Minta akses
uji coba is the primary action; the deck is secondary. The header trial link uses outline/ghost styling when
the hero's primary button is in the same view. Proposed headline: Dari rekening koran ke laporan keuangan;
supporting copy: Setiap angka bisa ditelusuri. Akuntan Anda memutuskan yang perlu ditinjau.
Later sections expand source → journal → reports → close,
using distinct screen-led compositions. Avoid repeating the same promise and stat across sections. Any displayed
demo number names its period/entity and is never presented as business traction. Legal pages prioritise reading,
with the draft notice first, and a clear route back to Buku/contact. Keep Masuk and trial navigation compact on
phones. A screenshot is presented as a screenshot, never as a fake interactive app.

### Test seams

- E2e: update `e2e/workspace.spec.ts` so `/` is public while protected routes retain session enforcement; retain
  sign-in/out coverage. Add public-site navigation, member/admin/company/support destinations, legal links,
  form consent/error/thank-you states and 390 px overflow assertions alongside existing access tests.
- Unit: extend `tests/unit/bank-coverage.test.ts` to validate the landing's actual bank claims against `BANKS`
  and `LAYOUTS`, including formats/counts rather than checking a duplicated hard-coded list. Test rendered legal
  content for the support-access and trial-data sections on both pages and absence of vendor branding.
  Test configured/missing support contact and legal links in every auth-email template/generated payload.
- Visual/manual: reproducible product captures, all five public pages at two widths, keyboard/screen-reader and
  reduced-motion walks, production-build mobile Lighthouse. Reuse the current demo and local mail-capture setup.
- Gates: task gate before implementation commits; full gate and verify-local before marking the feature PR ready,
  per `AGENTS.md`. No paid model call, seed against a hosted database, or production test account.

### Non-goals

Pricing page, blog, cookie banner, analytics/tracking installation, database consent records, English version,
billing, live bank feeds, new accounting features, changing posted figures, public live-demo access, per-tenant
OCR consent, automatic retention/deletion jobs, final legal sign-off, startup application submission, provider
migration/integration or affiliation claims, domain/email provisioning, hosted auth configuration, deployment
and merging to production. The owner merges after implementation and verification.

### Assumptions

1. The existing company-books and live-support destinations should remain as implemented by the access cycle;
   Beranda in the brief refers to ordinary accounting-firm members. Buku admins outside support go to Backoffice.
2. Static, explicitly synthetic product screenshots meet the real-product requirement. Use a pinned demo month
   and scope, inspect the actual values before publishing, and retain genuine blockers in the close screenshot.
3. The legal draft discloses current retention honestly rather than promising a numerical deletion deadline.
   A new retention policy or purge mechanism needs separate approval. The owner confirms legal entity/contact
   details and the legal wording before treating these pages as final or onboarding external trials.
4. No new dependency or motion piece is needed. Screenshot/Lighthouse tooling can be run as development tools
   without changing the package manifest; adding a dependency reopens the gate.
5. The owner will configure the public domain and a monitored support email before using the site in an external
   application. The neutral fallback is acceptable during development, not evidence of a configured mailbox.
6. Application-quality work is included; claims about program acceptance or a specific provider are not. Company
   facts, traction and any intended provider usage for the private application remain the owner's statements.

### Gate re-openers

Named auth behavior is limited to the public-home session dispatch, shared public/legal navigation and email
links. Named PII work is disclosure of existing processing and a consent line; collection, purposes, retention
storage, support access and permissions do not change. Reopen for any further auth/PII behavior change, schema
migration, new dependency, new React Bits piece (including its ui-rules/licence update), real model call/credit
use, accounting-invariant change, promised deletion schedule, production write, hosted configuration or non-goal.

## Tasks

- [x] T1 Public-home dispatch and shared public navigation — accept: signed-out home is public, firm/company/
  admin/support destinations and protected routes hold; header/footer work at 390 px. Deps: approval. Reuse
  `getWorkspaceSession`, `getPlatformAdmin`, existing workspace layout, `PublicShell`, `BrandMark`, UI primitives.
- [x] T2 Draft Terms/Privacy and contact — accept: both legal pages render required support/trial/AI/retention
  sections, visible draf notes and valid/fallback contact with passing content tests. Deps: T1. Reuse public shell
  and server-only `BUKU_SUPPORT_EMAIL`; source facts from `lib/signup.ts`, `lib/auth/support.ts`, `lib/ai`,
  `lib/ocr`, `lib/evidence`, `lib/controls/ai-review.ts`, `lib/reports/report-comment.ts` and the access ADR/cycle.
- [x] T3 Trial/login and email legal links — accept: consent sits under submit, both pages and every auth email
  link to both legal pages; generated payload and scanner-safe invite/recovery tests pass. Deps: T2. Reuse
  `SignupForm`, `PublicShell`, support markers, `scripts/auth-config.ts` and local mail capture; no hosted apply.
- [ ] T4 Demo capture script and optimised product assets — accept: one local-only command regenerates bank-to-
  journal, Neraca Saldo and close images with source/amount agreement and no real data/model calls. Deps: T1.
  Reuse demo seed, existing authenticated Playwright setup and source drill-down; no scenario/ledger change.
- [ ] T5 Landing story and public metadata — accept: two audience narratives, primary/secondary actions, all
  three readable product views, fixture-backed bank claims, token styling and approved motion only. Deps: T2,
  T4. Reuse the checked decks, `next/image`, existing metadata/Open Graph/favicon and motion conventions.
- [ ] T6 Complete local verification and polish — accept: public/session/form/email flows pass; five public
  pages at 1440/390 and thank-you are inspected; anti-slop, accessibility and mobile Lighthouse thresholds pass;
  task/full gates and verify-local evidence are recorded for the head. Deps: T3, T5. Reuse existing access tests.
- [ ] T7 Documentation and review handoff — accept: capture/run instructions and route/docs changes are current,
  cycle record contains implementation/verification/ship evidence, PR has highlight screenshots, required CI
  passes and the feature is ready for the owner's merge. Deps: T6. Review deck claims during ship; change decks
  only if a claim changed. Record owner prerequisites: legal confirmation, domain/support and email config.

Tasks are sequential implementation commits; T4 can be researched while T2/T3 are underway but shares the local
demo capture environment. This spec stage has one tightly connected document and is handled inline.

## Implementation

- Approval: the owner approved the spec and requested completion through merge on 2026-10-10. This authorises
  merging this verified PR to main, superseding the spec's owner-merge non-goal for this cycle.
- Plan: T1 routing/shared frame inline (it establishes the integration contract); T2 legal content and T4
  demo-capture research in parallel workers; T3 trial/mail links after T2, T5 landing after T4; T6/T7 verification,
  review and merge sequenced by the driver. Standards/spec review uses separate workers; sensitive-path changes
  receive security review. Every implementation task is gated before its commit.

- T1: public home dispatch reuses the live session and protected workspace shell; answer history now persists
  across root/workspace navigation. Shared header/footer, skip link and server-owned contact are in place;
  general errors do not opt into auth background motion. Home/support/admin route tests were extended.
  Standards, spec and security reviews passed after mailbox encoding and live-support coverage fixes.
  Gate: lint/typecheck pass; 224 files / 1,535 tests pass. Early 390 px browser walk returns 200 on all five
  public pages with one h1 and no horizontal overflow; full authenticated flow verification follows in T6.

- T2: both dated legal pages share the public frame/contact and prominently remain drafts. Trial-request
  fields and separate throttle records, honest retention, expiry, quiet read-only support, task-specific AI
  payloads and data rights are disclosed. Both content/source reviews passed; eight rendered legal tests pass.
  Gate: lint/typecheck pass; the completed full suite passes 224 files / 1,535 tests, including T2 and T3.

- T3: trial consent links sit below submission; pending, focused field-error/thank-you and transport-failure
  retry states preserve the existing fields and neutral acknowledgement. Login/trial use server contact.
  All seven email templates and generated payloads include legal links outside the unchanged support markers;
  scanner-safe destinations remain intact. Captured invitation and recovery legal-link walks are in e2e.
  Standards/spec/security review passed, including a retry fix. The same completed full task gate above covers
  these unchanged T3 files; fresh lint/typecheck and the interactive retry check also pass before committing.

## Verification

## Ship Notes

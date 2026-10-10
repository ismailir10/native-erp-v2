# Public site: a deliberate product composition

## Context

The owner finds the newly shipped public page visually average and explicitly requests continued iteration.
The content is accurate, but uniform section layouts and oversized full-report screenshots weaken its hierarchy.
The intended result is a distinctive, credible product page for prospective accounting firms, companies and
startup-program reviewers, retaining the genuine synthetic evidence from the preceding public-site cycle.

## Decisions

1. Strengthen the opening composition and use the deck's paper-and-ledger illustration grammar. Illustration
   shapes remain visibly explanatory, with genuine app screens below. No invented chart series or figures.
2. Give source traceability, close review and company reports distinct visual treatments. Focus large evidence
   views on useful details, while keeping complete captured views available through native disclosures.
3. Keep Bahasa, existing typography and colour tokens, flat surfaces, restrained existing arrival/CheckDraw
   motion and reduced-motion support. No em dashes in public copy, new dependency or motion piece.
4. Keep claims qualified and captured numbers current; preserve routes, consent/legal wording, session dispatch
   and tenant behavior.
   The owner's standing instruction to proceed through merge also applies to this requested visual iteration.

## Acceptance criteria

- [x] At 1440 and 390 px, the opening has clear typographic hierarchy and a coherent deck-inspired illustration;
  it does not rely on stock art, fake charts, gradients, shadows, identical feature cards or animation decoration.
- [x] Each product section retains readable genuine evidence or verified synthetic values. Source row and related
  journal agree, actual close blockers remain visible, and report totals remain exact. Complete close/report
  captures are accessible without making their tiny text the main visual on desktop or phone.
- [x] The story has deliberate changes in scale and composition, one primary action per view, clear audience
  distinctions, visible synthetic labels and working trial/deck/legal links. No horizontal overflow or em dashes.
- [x] Keyboard, semantic headings, image descriptions, native disclosure behavior and reduced motion pass.
  Mobile production-build Lighthouse medians are home 94, Terms 97 and Privacy 97; accessibility is 100.
  The original performance target was 95 on all three pages. The owner-directed merge on 2026-10-11
  accepts the disclosed home exception; no claim is made that the original home target passed.
- [x] Local task/full gates pass; desktop/phone visual iterations and separate standards/spec reviews show no
  unresolved in-scope polish. Deck coverage, human review, traceability, close, exports and data claims still agree.

## Verify flows

1. Signed-out prospect opens home at desktop and phone sizes, reads source/journal proof, opens full close/report
   captures, follows deck and requests trial access; consent legal links still work.
2. Keyboard prospect uses skip navigation and section/disclosure links, then reduced-motion browser repeats the
   opening. Edge: 390 px, long source filename and expanded captures remain within the viewport.
3. Existing signed-in firm/company/admin/support routes and trial error/acknowledgement behavior pass the existing
   full browser suite. No new account or production data is used.

## UX notes

The opening carries the product promise and one trial CTA. Product sections explain a specific accounting job
through an identifiable piece of evidence. Supporting provenance is concise and readable, rather than repeated
in dense captions. Full report/checklist views use explicit native disclosures.

## Test seams

Reuse rendered public-product assertions, public-route browser tests and the complete existing suite. Inspect
screenshots at both widths and default mobile Lighthouse on the production build; avoid tests of styling classes.

## Non-goals

New product features, accounting changes, new demonstration scenarios, auth or legal changes, pricing, traction,
analytics, provider affiliation, hosted configuration and startup application submission.

## Assumptions

This is an explicitly requested visual follow-up within the owner's previously approved scope and merge
authorization. Capture evidence must agree with the integrated main branch. If concurrent accounting work changes the same
synthetic controls, refresh only the affected saved views through the existing guarded read-only capture script.

## Gate re-openers

New dependency or motion piece, schema/auth/PII/accounting change, paid model call, real client data, production
data/configuration writes or new capability claims.

## Tasks

- [x] T1 Redesign and iterate the public composition: stronger opening, useful source/close/report proof, genuine
  evidence and full-view disclosures; reuse tokens, saved captures, money formatter and approved motion.
- [x] T3 Integrate the updated base and resolve evidence/cache/loading findings without changing product,
  auth or client-control behavior. Depends on T1; required by existing accuracy/performance criteria.
- [x] T4 Resolve the immediate shortcut regression and retain the documented owner-accepted home
  performance exception below. Keep
  global shortcut/input/provider behavior eager and preserve original control behavior and browser assertions.
  Isolate sidebar navigation and scope selectors in their own default-SSR boundaries with one shared original
  sidebar context. Retain the reviewed font range and exact headline subset; grouped-shell loading is removed.
- [x] T2 Verify and prepare release: complete gates, independent reviews, final screenshots/Lighthouse and accurate
  cycle/PR evidence. Exact-head CI and owner-authorised merge are subsequent release gates tracked in Ship Notes.
  Depends on T1, T3 and T4; the Rupiah qualification must match the integrated deck.

## Implementation

- Current status: verified locally and approved to merge. The owner instructed "get them merged" on
  2026-10-11 after the documented 94-versus-95 choice. This authorizes release of the current measured
  candidate with its home performance exception, without broader routing work. The original 95 target
  is not claimed as met: home median is 94; legal medians are 97 and accessibility is 100 throughout.
  Both complete local browser modes pass. New exact-head CI remains mandatory before merge.
- Current topology: session/access queries, filtered clients, module mapping, company conditions and banner
  calculation remain in the original server AppLayout. Ask, client palette, history, access and navigation
  progress stay eager. SidebarProvider, useSidebar, SidebarInset and SidebarTrigger
  are extracted byte-for-byte into one client context module and re-exported by the original sidebar module.
  The mobile trigger is eager and renders the former MobileTrigger wrapper's identical JSX. Only the original
  AppSidebar navigation and WorkspaceScopeBar selectors have their own loading-null, default-SSR boundaries;
  neither wraps the editable Ask input or a global provider. Scope URL canonicalization waits for its hydration.
  The shortcut's existing handler uses a layout effect, with unchanged conditions/deps/cleanup and a memoized
  context value. No control implementation, auth decision or browser assertion is changed.
- Notification delivery: the root NotificationHost uses the existing root session boolean or a backoffice
  pathname to render the unchanged Toaster with its original bottom-right/closeButton props. Public/auth and
  link-upload forms have inline feedback and no toast producers. SupportBar remains under the original support
  condition and keeps its props, audit/expiry/exit implementation. Each notification component has its own
  loading-null default-SSR boundary, outside eager inputs and global providers. Original Sonner subscription
  replays active queued notifications. These boundaries change loading only; auth/session checks are untouched.
- Headline delivery: the existing Hanken 450 headline uses an exact 1,748-byte character subset embedded in
  the existing stylesheet as a data URL. Only the unchanged landing h1 receives its class. Original root/body
  font and all other text retain their existing font. Artifact/source hashes, actual cmap, weight, reproduction
  recipe and full OFL provenance are recorded in `app/fonts/`. Independent parsing and HarfBuzz shaping verify
  all 40 headline glyph selections, advances and positions match the original 450 instance exactly. The
  rendered-heading guard verifies character coverage, pinned hash and equality of embedded/artifact bytes;
  new headline characters require regeneration. No dependency or additional font request is added.
- Approval: owner explicitly requested continued visual iteration on 2026-10-10; standing completion-through-merge
  authorization persists. No additional approval is required for this bounded refinement.
- Plan: T1 illustration worker and composition driver in parallel with disjoint files; the driver integrates and
  iterates because overall hierarchy requires the complete page. Standards and spec reviewers remain separate.
  T2 verification/documentation/release are sequenced by the driver.

- T1: the opening has a balanced two-line desktop headline and an ink outlined paper fan, bound ledger and
  folded reports. Actual source row and account names give the illustration meaning. Sections vary their scale;
  readable close details and exact manifest-derived control counts replace the full-height checklist, while a
  report preview pairs with a native-size genuine total crop. Full captures remain available at both widths.
  Phone headings, supporting copy and spacing are tighter. The initial visual task changed no assets, product
  claims or dependencies. See the integration note below for the narrow evidence refresh required by main.
- T1 iteration: five visual rounds improved contours, headline balance, close detail scale, caption/navigation
  accuracy, phone length and desktop total legibility. The headline remains plain semantic text; CSS balances
  its lines. Separate standards/spec reviews clear the final source and desktop/phone production captures.
  All ten public page captures have no console/resource errors; anchors work without overflow at 1440, 1024,
  768 and 390 px, and reduced motion disables arrival/check animations. The unchanged legal/auth captures also
  pass independent visual review.
- T1 gate: lint and typecheck pass; 226 files / 1,540 tests pass (337.48 seconds); production build passes.
  Complete book/browser gates and Lighthouse remain the T2 release evidence.

- T2, pre-integration: all required local gates completed on the unchanged T1 runtime. Production captures, complete desktop
  and phone disclosures, keyboard links, reduced motion and trial acknowledgement are inspected. The React
  checklist and separate standards/spec reviews pass with no unresolved visual or source finding. No routes,
  setup instructions, environment variables or capability claims changed, so the existing README remains true.

- Integration: main advanced to `f4e4280` (bank-import correctness) before PR creation; rebase was clean.
  Its stricter source-completeness controls change the unchanged demo from 14 PASS / 7 REVIEW to 12 PASS /
  9 REVIEW. Mandiri reconciliation and completeness now require review, and BCA completeness detail changes.
  The existing guarded capture refreshes three affected close screenshots and the manifest, verifies all 222
  source rows and 1,765 book checks, and makes no book/model write. Source/journal and TB values remain exact.
  The bank-format copy now explicitly qualifies Rupiah accounts to match the revised decks.
- Evidence delivery: review caught stale desktop optimizer bytes at unchanged image URLs. Capture output now
  records each WebP's SHA-256, and required `next/image` plus responsive picture sources use that hash in their
  URLs. Next.js permits the exact manifest path/hash pairs alongside existing query-free images. Tests recompute
  file hashes and verify rendered URLs. A separate guarded capture into scratch verified future regeneration.
- Historical loading: the integrated page initially measured 91/100, below the original mobile target. Branch-local member
  imports reached 94/100 but retained workspace controls. The T3 thin client facade splits only Ask and Scope
  through default-SSR dynamic imports. At T3 the app shell retains its original direct imports; component
  implementations, JSX/props, guards, root history and early-input adoption were untouched. The two-leaf and
  subsequent grouped-shell candidates were later rejected by exact-head CI; neither remains the release candidate.
  Pure button variants are extracted unchanged and re-exported; server style users avoid the interactive
  primitive. Shared public navigation retains client routing with prefetch disabled; signed-out home uses
  document links. T3 required optimized-image measurements are home 95/100, Terms 96/100 and Privacy
  96/100, with no layout shift. Home script transfer is 284,442 bytes versus roughly 299–305 KB in intermediate
  builds. Unsupported server-only lazy boundaries and a native-image experiment were removed; the original
  `next/image` requirement remains satisfied.
- Hydration finding: a broader nine-control facade reached 96/100 and 197,866 script bytes, but its full suite
  caught an immediate Ctrl+K lost on Beranda (87 of 88 passed). The switcher's native listener was not installed
  when the visible SSR heading became ready; a read-only browser probe confirmed that timing. Making only
  the switcher provider eager still failed (8 of 9 focused cases). Restoring the shell's original loading paths
  passed the local reproduction with all nine unchanged focused cases passing (44.5 seconds), including the
  immediate shortcut, desktop/phone switching, early typed input and persistent context. The lower-transfer
  shell version and failed runs are not release evidence. That two-leaf runtime required renewed full
  gates; interrupted runs and below-target measurements do not count as passes.

- Historical T3 task gate: lint, typecheck and production build passed; 236 files / 1,871 unit/database tests
  passed (564.78 seconds). These two-leaf results do not cover the current diagnostic candidates or satisfy
  the reopened T2 release gate.

## Verification

### Pre-integration verification: b334875d7bcc8641f31a5d7cc472ab9834445b0d, 2026-10-10

Historical runtime evidence; shared screenshot paths are reused by later diagnostic builds and do not
identify this runtime without a pinned capture.

- Gate: `npm run lint && npm run typecheck && npm test` passes: 226 files / 1,540 tests (337.48 seconds).
  `npm run build && npm run demo:reset && npm run verify:books && npm run test:e2e` passes:
  `ALL PASS` / 1,765 checks; `86 passed (9.0m)`. Logs: `/workspace/work/composition-verified-*.log`.
- App: final production build at http://localhost:3200, local synthetic Postgres 16 books and the existing local
  GoTrue/Mailpit/Kong Auth stack described in the preceding cycle. Paid model keys remain blank. No hosted
  data or configuration is read for captures or changed by tests.
- Walked: signed-out home, source/journal proof, exact close controls, compact report and both complete captures
  at desktop/phone; section links at 1440, 1024, 768 and 390 px; deck/trial/legal navigation, trial validation and
  acknowledgement. The full suite covers member/company/admin/support routes, scanner-safe invitation/recovery,
  expiry/revocation, tenant roles, protected writes, early input and persistent scope/history.
- Accessibility: one h1/main, keyboard skip/focus and native disclosures, source account names retained in the
  phone caption, descriptive figures, no horizontal overflow, correct reading order and reduced-motion checks
  pass. Reading order was inspected through browser accessibility snapshots, not a separate assistive-device audit.
- Console/network: ten final public page/viewport checks have no unexpected errors or failed resources. Full
  suite negative auth/tenant cases retain their expected refusal behavior.
- Lighthouse: default mobile simulated slow 4G, 412 × 823, CPU slowdown 4×, Lighthouse 13.5.0 / Chromium
  151.0.7922.173, final production build. Performance/accessibility: home 96/100, Terms 95/100, Privacy 95/100.
  Home LCP 2.8 seconds, TBT 40 ms, CLS 0. Reports: `/workspace/work/composition-lighthouse-{home,syarat,kebijakan-privasi}.json`.
  No relaxed settings or repeat-until-green measurement.
- Screenshots: `/workspace/work/composition-production-{home,terms,privacy,login,trial}-{1440,390}.png`,
  both expanded close/report captures, `/workspace/work/composition-production-report-{1440,390}.png` and
  `test-results/daftar-terima-kasih-390.png`. Driver inspected the changed page/proof and acknowledgement;
  a separate reviewer inspected all sixteen full/top unchanged legal/auth captures without regressions.
- Highlights: `/workspace/work/composition-production-home-1440-top.png` and
  `/workspace/work/composition-mobile-hero.png` (complete phone opening, 390 × 888).
- Rounds: five passes with progress. Stronger drawing contours and real account names, balanced headline,
  readable close crops/counts, accurate section destinations, shorter phone copy/spacing and native-size report
  totals resolved the in-scope findings. The final round and independent reviews found nothing further to fix.
- Not checked: production member session and target Vercel build logs still require unavailable project/member
  access. The preceding cycle's legal/domain/contact operator prerequisites remain; this visual change neither
  asserts legal sign-off nor submits a startup-program application.

### Historical local verification: a942a65c62f739cd58bab5004c48749c68fc0fba, 2026-10-10

- Gate: lint, typecheck and production build pass. Unit/database suite: 236 files / 1,871 tests
  passed (564.78 seconds). Synthetic reset and book verification pass: `ALL PASS` / 1,765 checks. Complete browser suite: `88 passed (10.9m)`.
  Logs: `/workspace/work/composition-final-*.log`; the built code is identical to the marked runtime commit.
- App: production build at http://localhost:3200, Postgres 16 synthetic books and local GoTrue/Mailpit/Kong Auth.
  Unit tests use `buku_test`; browser tests use `buku`. No paid model keys or production data/configuration writes.
- Walked: home, Terms, Privacy, login and trial at 1440/390 px; source/journal proof, current 9 REVIEW / 12 PASS
  close details, report totals and complete native disclosures; deck/trial/legal routes, keyboard skip/focus,
  anchors at 1440/1024/768/390 and reduced motion. Ten public checks have empty errors/failures and no overflow.
  Metadata, image completion and descriptive alternatives pass. Reading order was inspected through browser
  accessibility snapshots, not a separate assistive-device audit.
- Member regression: unchanged full tests cover firm/company/admin/support dispatch, scanner-safe invitation
  and recovery, roles/tenant restrictions, trial expiry, protected writes, client palette/sidebar navigation,
  text typed before hydration and persistent scope/period/history. The initially missed shortcut also passes
  all nine focused navigation/input/history cases (44.5 seconds) after restoring original shell loading.
- Evidence: source row 11 and its Rp 335.350.000 balanced journal, current Mandiri blockers, all-entity close and
  exact Rp 12.552.852.217 TB totals remain genuine synthetic captures. All fourteen hashes match saved bytes.
  Guarded scratch regeneration verifies fourteen outputs, 222 source rows and 1,765 books checks without writes.
- Lighthouse: required optimized images, default simulated mobile slow 4G, 412 × 823, CPU slowdown 4×,
  Lighthouse 13.5.0 / Chromium 151.0.7922.173. Performance/accessibility: home 95/100, Terms 96/100,
  Privacy 96/100. All CLS 0; home LCP 2.9 seconds, TBT 50 ms and 284,442 transferred script bytes.
  Reports: `/workspace/work/composition-final-lighthouse-{home,syarat,kebijakan-privasi}.json`.
  No relaxed settings or repeat-until-green measurement. This candidate was subsequently rejected by CI;
  these scores do not establish current release readiness.
- Screenshots: `/workspace/work/composition-production-{home,terms,privacy,login,trial}-{1440,390}.png`,
  expanded close/TB views and current acknowledgement capture `test-results/daftar-terima-kasih-390.png`.
  Highlights: `/workspace/work/composition-production-home-1440-top.png` and
  `/workspace/work/composition-mobile-hero.png` (390 × 888 complete opening).
- Review: five visual rounds resolved hierarchy, contours, source/account accuracy, close detail scale,
  phone length and readable report totals. Driver and separate standards/spec reviewers inspected frozen
  source, final desktop/phone views and public metrics. Both independent gate/record reviews pass with no unresolved finding.
- Not checked: signed-in production real-firm view and target Vercel build logs require unavailable project/member
  access. Existing legal/domain/contact operator prerequisites remain; no legal sign-off, startup eligibility
  or submitted application is asserted.

### Historical local verification: e18d4016bf5191ff4b3bb45a1ba29cb30f79638a, 2026-10-10

Rejected for release by the subsequent exact-head private-mode E2E failure. The observed local results are
preserved below; grouped-shell source, metrics, reviews and gates do not cover the current diagnostic candidate.

- Gate: lint, typecheck and production build pass. Unit/database suite: 236 files / 1,871 tests
  passed (581.16 seconds). Synthetic reset and book verification pass: `ALL PASS` / 1,765 checks.
  Complete unchanged browser suite: `88 passed (10.9m)`. Logs: `/workspace/work/composition-font-*.log`.
  The tested build was identical to this commit. Later rollback and diagnostic changes require renewed gates.
- App: production build at http://localhost:3200, synthetic Postgres 16 books and local GoTrue/Mailpit/Kong Auth.
  Unit/database tests use `buku_test`; browser tests use `buku`. Paid model keys remain blank. No production writes.
- Walked: all five public/auth pages at 1440/390 px, source/journal proof, current 9 REVIEW / 12 PASS close,
  readable report totals and both complete native disclosures, deck/trial/legal links, skip/focus, headings,
  anchors at 1440/1024/768/390 and reduced motion. Ten browser checks have no errors, failed resources or overflow.
  Reading order was inspected through browser accessibility snapshots, not a separate assistive-device audit.
- Member regression: original company/admin/support dispatch, scanner-safe invitations/recovery, tenant roles,
  protected writes, expiry/revocation, client palette/sidebar, early typed input and scope/history all pass.
  The grouped shell passes nine unchanged focused cases (45.4 seconds). Holding actual shell/Ask/Scope chunks
  preserves SSR question text at both widths; after the real Ask control hydrates, shortcut, canonical scope
  and navigation work. The probe does not assert global shortcut readiness before hydration commit.
- Source: server guards, filtered client queries, module mapping and access/banner calculation stay server-side.
  The original client shell imports its providers/controls together behind one default-SSR boundary. Context
  identities, JSX, props and input adoption remain; only shortcut registration phase and its context value
  stability change. Rejected local Suspense and individual-shell-leaf experiments are not in this runtime.
- Evidence: source row 11 and its balanced Rp 335.350.000 journal, actual Mandiri review findings, all-entity
  close and exact Rp 12.552.852.217 TB totals remain synthetic genuine captures. All fourteen saved hashes
  match bytes; guarded scratch regeneration verifies 222 source rows / 1,765 checks without book/model writes.
- Font: the same Hanken typeface retains every glyph and used weight, including 450 headings; licensed source,
  asset hash and transformation recipe are recorded in `app/fonts/`. No dependency added. Fresh desktop/phone
  screenshots retain headline wraps, spacing and readable evidence. The served 23,184-byte font matches the asset.
- Lighthouse: required optimized images, default simulated mobile slow 4G, 412 × 823, CPU slowdown 4×,
  Lighthouse 13.5.0 / Chromium 151.0.7922.173. Performance/accessibility: home 95/100, Terms 97/100,
  Privacy 96/100; all CLS 0. Home LCP 2,958 ms, TBT 46.5 ms and 196,142 script bytes.
  Reports: `/workspace/work/composition-font-lighthouse-{home,syarat,kebijakan-privasi}.json`.
  No relaxed settings or repeat-until-green measurements. Older reports above are historical.
- Screenshots: `/workspace/work/composition-production-{home,terms,privacy,login,trial}-{1440,390}.png`,
  expanded close/TB views and current trial acknowledgement `test-results/daftar-terima-kasih-390.png`.
  Final PR highlights are pinned uploads from 12:28 UTC; authenticated repository bytes match both local files.
  Inline rendering needs a signed-in GitHub browser session unavailable here, so no rendering claim is made.
- Review: driver and separate standards/spec reviewers clear the frozen source, final desktop/phone views,
  font provenance and public measurements. Both final independent gate/record reviews pass without findings.
- Not checked: signed-in production real-firm view and target Vercel build logs require unavailable project/member
  access. Existing legal/domain/contact operator prerequisites remain. No legal sign-off, startup acceptance
  or submitted application is asserted. Exact-head CI is a subsequent release gate, not a local test result.

### Historical diagnostic benchmark: localized sidebar/scope and inline headline, 2026-10-10

The plan was fixed before additional samples, after the first final-build sample was observed. Exactly three
samples were retained for every page, using unchanged default mobile slow-4G/CPU-4 settings, a fresh browser
per sample and no parallel work. The count was not expanded or filtered by outcome. Earlier historical 97
scores are excluded. Removing an unused sidebar import left compiled JS/CSS/font URLs and transfers identical.

| Page | Performance samples | Median | Range | Accessibility samples | CLS |
|---|---|---|---|---|---|
| Home | 93, 92, 96 | 93 | 92 to 96 | 100, 100, 100 | 0 in every sample |
| Terms | 97, 97, 97 | 97 | 97 to 97 | 100, 100, 100 | 0 in every sample |
| Privacy | 98, 96, 96 | 96 | 96 to 98 | 100, 100, 100 | 0 in every sample |

Home fails the unchanged 95 performance target. Legal medians pass; these results do not establish current
release readiness or guarantee every run's score. Plan/results: `/workspace/work/composition-safe-benchmark-{plan,results}.json`;
all nine reports: `/workspace/work/composition-safe-lighthouse-{page}{,-2,-3}.json`. These results precede
the paired-notification source below and do not cover it.

### Current diagnostic benchmark: paired notification boundaries, 2026-10-10

The plan was fixed before any sample: exactly three per page, unchanged default mobile slow-4G/CPU-4
settings, fresh browsers and no parallel work. All nine results are retained. No sample expansion, filtering
or further measurement is used to turn this result into a pass.

| Page | Performance samples | Median | Range | Accessibility samples | CLS |
|---|---|---|---|---|---|
| Home | 94, 96, 94 | 94 | 94 to 96 | 100, 100, 100 | 0 in every sample |
| Terms | 97, 96, 97 | 97 | 96 to 97 | 100, 100, 100 | 0 in every sample |
| Privacy | 96, 97, 97 | 97 | 96 to 97 | 100, 100, 100 | 0 in every sample |

Home transfers 245,055 script bytes in every sample. Its median improves from 93 to 94, but still fails
the original 95 target; both legal medians pass. Plan/results:
`/workspace/work/composition-notifications-benchmark-{plan,results}.json`. Current complete local gates
and browser evidence pass at the runtime SHA below; prior interrupted runs do not count.

Following the 94-versus-95 choice, the owner instructed "get them merged" on 2026-10-11. Proceed with
this candidate and its disclosed home-median-94 exception, preserving the existing routes. This does not
claim the original 95 target passed. Full functional gates and independent reviews pass; both exact-head
CI modes remain required before release.

### Verified locally: 374fa378b1768eecf111b4b76f7bcb213f0ed60f, recorded 2026-10-11 (Asia/Tokyo)

- Lint, typecheck and production build pass. Unit/database gate: 236 files / 1,872 tests passed
  (370.62 seconds). The earlier interrupted unit run does not count.
- Synthetic reset and book verification pass: ALL PASS, 1,765 balance checks. No production data or paid
  model calls are used.
- Ten public/auth desktop and phone page checks pass with no browser errors, failed resources or overflow.
  Native close/TB disclosures, keyboard skip/focus, four-width anchors and reduced motion pass.
- Held sidebar/scope chunks: first Ctrl+K, retained Ask typing, canonical scope, phone menu and client
  navigation pass at both widths. Global handlers and editable input remain eager.
- The headline uses one custom font at both widths; CDP rendered glyph counts match the original font
  baseline (39 desktop / 38 phone, excluding collapsed line-break spaces). Heading wraps remain 2 / 3 lines.
- Notification identity proof: anonymous pages request no Toaster wrapper; real member login and the
  admin without workspace membership load it. Queued-toast injection remains unverified: the bounded
  runtime hook did not settle. Installed Sonner retains/replays active queued toasts; normal error-toast
  delivery passes in both complete browser modes.
- Driver and independent source/hero visual reviews pass. Fresh highlight bytes match the repository
  uploads recorded in `/workspace/work/composition-notifications-highlight-evidence.json`.
- Complete private-mode browser suite: 88 passed (9.4 minutes), including immediate Beranda Ctrl+K,
  member/company/admin/support dispatch, support audit/exit, notifications and scope/history. The first
  setup attempt was blocked by local demo-admin variables in private mode; clearing only those local
  command variables allowed the unchanged suite to run. No application/config/test change was made.
- Complete demo-mode browser suite: 88 passed (9.3 minutes), on the same frozen runtime. This closes
  local functional verification; both full runs include the unchanged immediate shortcut and early-input cases.
- Highlights: fresh desktop and phone captures in PR #142, pinned to commits `5b21b356` and `91100458` on
  pr-assets; all uploaded bytes match local screenshots. Inline GitHub rendering requires a signed-in
  browser session unavailable in this sandbox.
- Performance exception: owner-directed merge of this measured candidate on 2026-10-11 accepts home
  median 94 (samples 94/96/94); both legal medians are 97, all accessibility samples 100 and all CLS 0.
  The original 95 performance target remains a disclosed exception; no new routing or session work is added.
- Pending: check and both complete exact-head CI modes before SHA-pinned merge. Only docs follow this
  runtime commit. Production member session and build-log checks remain access-limited; no legal sign-off,
  startup acceptance or submitted application is asserted.

## Ship Notes

- Deck review: no deck change. Both audience decks still agree with uploaded files and registry-backed coverage,
  human approval of AI suggestions, source traceability, close controls, derived reports and Excel/PDF exports.
  The paper/ledger composition borrows their drawing grammar without importing illustrative charts or loops.
- Release: local criteria pass with the owner-accepted performance exception. Keep the e2e label and mark
  PR #142 ready with current evidence/highlights.
  Require check and both demo/private E2E success on
  the exact pushed head before the owner-authorised merge. No preview or separate promotion.
- Blast radius: public composition, typed capture/hash metadata, exact optimizer queries, unchanged button
  styles, member UI import boundaries, switcher listener/context-value timing and equivalent font delivery, existing evidence assertions, three refreshed close assets and this
  record. No auth/schema/accounting, hosted configuration or dependency changes; no migrations or operator
  apply step. Rollback: revert the refinement merge. Member hydration/navigation is the additional risk covered
  by the complete browser suite, including early input, scope/history, sidebar and support access.

- Post-merge: confirm the merge deployment succeeds and public home contains the refined illustration/story;
  GET legal/login/trial pages, genuine images, fonts, metadata and icons with verified TLS. Do not create a
  production test account. Signed-in real-firm and build-log checks require the same operator access as before.

- CI re-opened: check passed for head `390fd0d`, but E2E run `38048725029` failed the immediate
  Beranda Ctrl+K case (87 passed / 1 failed); the private-mode pass was skipped. PR #142 returned to draft.
  Local a942 results above remain historical evidence and do not satisfy release. New exact-runtime gates
  and exact-head CI are required.

- Rejected loading experiments: local Suspense around pending Ask/Scope could replace the phone SSR
  textarea; memoizing the switcher context did not resolve that case. Five individual shell leaves and the
  grouped shell passed focused local tests but did not establish release correctness. The whole-home
  prototype also missed the desktop shortcut and showed a phone heading fallback. All those files/boundaries
  were removed. Earlier held-chunk probes checked typing and shortcuts after Ask hydration; they did not
  prove readiness at browser load or replace the unchanged immediate-shortcut suite and exact-head CI.

| Historical candidate | Focused cases | Home performance | Script bytes | Disposition |
|---|---|---|---|---|
| Listener at commit, Ask/Scope leaves | 9 passed, 45.0 seconds | 94 | Not recorded here | Below target |
| Five individual leaves | 9 passed, 45.6 seconds | 91 | 280,252; 21 requests | Removed |
| Grouped shell before font optimization | 9 passed, 45.4 seconds | 94 | 196,142 | Below target |
| Grouped shell with reviewed font optimization | Full local gates passed at e18d | 95 | 196,142 | Rejected by private CI |

The retained Hanken range optimization preserves all 268 glyphs, Unicode mappings, vertical metrics and
used weights 400/450/500/600/700. Tested outlines/advances differ by at most one font unit from axis rounding;
representative HarfBuzz glyph selection matches, with combined positioning rounding at most two units
(0.032 px at 16 px). Font family, CSS variable, display swap and root history key remain unchanged. Full
license, source hash and transformation recipe accompany the artifact; timestamps/table serialization can
change reproduction bytes. These font facts do not validate the removed grouped-shell loading behavior.

- Renewed CI re-opened: head `97543391932a4ffee80a472bf95d3395d1ff0235` passed check run
  `38053070246`, including 1,871 tests
  (429.94 seconds). E2E run `38053070309` passed all 88 demo-mode cases (6.7 minutes), but private mode
  passed 87 and failed the immediate Beranda Ctrl+K case at `client-navigation.spec.ts:69`: the expected
  client bar did not appear. PR #142 returned to draft. The artifact request returned 403, so no trace was
  accessible and no trace-derived diagnosis is claimed.
- Confirmed diagnostic: with grouped-shell chunks held, the browser reached load while the shell was still
  unready; Ctrl+K was not captured and no palette appeared. This confirms that browser load alone did not
  establish shortcut readiness for that candidate. It does not establish a broader root cause. The grouped
  shell and Ask wrappers were removed, restoring original eager shell providers/controls and eager Ask.
- Historical performance investigation: the restored eager shell/Ask measured home 93/100 with 307,092 script
  bytes in a quiet mobile run. An earlier overlapping measurement was discarded. The global `inlineCss`
  experiment also measured 93/100 and increased HTML to 83,296 bytes from 19,756; the flag was removed.
  Notification experiments measured 91/100 and 92/100 and were removed. A pure server-wrapper experiment
  transferred 339,064 script bytes; no Lighthouse result was recorded and it was removed. The selector-only
  default-SSR local boundary measured 92/100 with 289,201 script bytes, below the unchanged 95 target.
  The sidebar/scope candidate with lazy mobile trigger measured 93/100 with 254,799 script bytes and passed
  held-chunk checks at both widths. The headline-only eager candidate measured 94/100 with LCP 3,101 ms
  and 307,092 script bytes. Neither measurement passes the original performance target.
- Local verification complete: eager-provider/input and localized-navigation source passes both full browser
  modes. Paired notification loading improves the home median to 94; the owner-directed merge accepts this
  disclosed exception. Original controls/assertions remain. T4/T2 are complete; exact-head CI is pending.

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
  Mobile production-build Lighthouse performance and accessibility each remain at least 95 on all three public pages.
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
- [x] T4 Register the existing shortcut listener during hydration commit after exact-head CI exposed the
  remaining passive-effect timing gap. Stabilize the existing switcher context value. Preserve default SSR,
  original control behavior and unchanged browser assertions. Group the original member shell behind one
  default-SSR boundary and trim only unused font weights to retain the original mobile performance target.
- [x] T2 Verify and prepare release: complete gates, independent reviews, final screenshots/Lighthouse and accurate
  cycle/PR evidence. Exact-head CI and owner-authorised merge are subsequent release gates tracked in Ship Notes.
  Depends on T1, T3 and T4; the Rupiah qualification must match the integrated deck.

## Implementation

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
- Loading: the integrated page initially measured 91/100, below the original mobile target. Branch-local member
  imports reached 94/100 but retained workspace controls. The T3 thin client facade splits only Ask and Scope
  through default-SSR dynamic imports. At T3 the app shell retains its original direct imports; component
  implementations, JSX/props, guards, root history and early-input adoption are untouched. T4 below changes
  only the switcher listener registration phase and stability of its existing context value.
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
  shell version and failed runs are not release evidence. The final two-leaf runtime requires renewed full
  gates; interrupted runs and below-target measurements do not count as passes.

- T3 task gate: lint, typecheck and production build pass; 236 files / 1,871 unit/database tests pass
  (564.78 seconds). The two-leaf runtime and final public measurements/captures are frozen. The full book and
  authenticated browser gate is tracked by T2 below.

## Verification

### Pre-integration verification: b334875d7bcc8641f31a5d7cc472ab9834445b0d, 2026-10-10

Historical runtime evidence; shared screenshot paths now hold the final integrated captures below.

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
  No relaxed settings or repeat-until-green measurement. Historical scores/failures above are superseded.
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

### Verified locally: e18d4016bf5191ff4b3bb45a1ba29cb30f79638a, 2026-10-10

- Gate: lint, typecheck and production build pass. Unit/database suite: 236 files / 1,871 tests
  passed (581.16 seconds). Synthetic reset and book verification pass: `ALL PASS` / 1,765 checks.
  Complete unchanged browser suite: `88 passed (10.9m)`. Logs: `/workspace/work/composition-font-*.log`.
  The built runtime is identical to this commit; subsequent verification-record edits change no runtime file.
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

## Ship Notes

- Deck review: no deck change. Both audience decks still agree with uploaded files and registry-backed coverage,
  human approval of AI suggestions, source traceability, close controls, derived reports and Excel/PDF exports.
  The paper/ledger composition borrows their drawing grammar without importing illustrative charts or loops.
- Release: update existing draft PR #142 with final evidence/highlights, retain the e2e label and mark ready. Require check
  and e2e success on the exact pushed head before the owner-authorised merge. No preview or separate promotion.
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

- T4 investigation: local leaf Suspense boundaries installed the shell listener while chunks were held, but
  initial phone hydration could replace the still-pending SSR textarea. Stabilizing the switcher context
  value preserved the desktop interleaved case but did not eliminate that phone startup issue. This
  experiment was removed entirely; the two default-SSR wrappers remain identical to a942. Failed experiments
  are historical findings, not release evidence.
- T4 final candidate: only the existing keyboard listener uses `useLayoutEffect`, registering synchronously
  at hydration commit instead of in the later passive-effect phase. Listener conditions, deps and cleanup
  are identical; the recents effect stays passive. The same `{open, clients}` context value is memoized by
  those two inputs, avoiding unrelated palette-state propagation while retaining real input changes. No
  other provider, context, input-adoption, tenant/auth or navigation implementation changes. Delayed chunks
  cannot imply readiness before hydration; verify retained SSR typing and the unchanged immediate default-load
  shortcut on desktop and phone, followed by complete gates.

- T4 delayed-loading probe: both leaf entry chunks are deliberately held. SSR question text survives release
  on desktop and phone; after the real Ask control becomes enabled, Ctrl+K, client navigation and canonical
  scope work. Releasing held chunks and sending the shortcut at browser load alone can precede hydration
  commit and does not establish readiness. The probe therefore does not claim before-hydration keyboard
  capture; the unchanged immediate default-load suite and exact-head CI remain required separately.

- T4 performance: the listener-at-commit candidate passes all nine unchanged focused cases (45.0 seconds)
  and held-leaf SSR typing/scope checks at both widths, but home measures 94/100 (legal 97/100 and 96/100),
  below the original target. This measurement is not final evidence. The next bounded loading change splits
  only sidebar/mobile-trigger/client-bar leaves, with all providers and contexts eager, original JSX/props
  and default SSR preserved. No new local Suspense fallback or control implementation changes.

- T4 loading finding: the five-leaf candidate passes the unchanged focused suite (45.6 seconds) and delayed
  typing/scope tests, but home measures 91/100 with 280,252 script bytes and 21 requests. Its extra request
  overhead outweighs the small transfer saving. This experiment is removed. The final candidate groups the
  unchanged member shell JSX behind one default-SSR client boundary; its original providers and controls
  import together inside it. All server session/access/client queries, module filtering and banner rendering
  remain in AppLayout. The existing serializable props and banner/children slots retain placement and guards.
  Ask/Scope wrappers stay as before; root history stays keyed in the original root. No independent lazy
  provider wrappers, custom loading fallback or new context module.

- T4 font delivery: the grouped shell passes the unchanged focused suite (45.4 seconds) and held-chunk
  SSR typing/scope checks at both widths, cutting home scripts to 196,142 bytes, but home measures 94/100
  (legal 96/100 each). These are intermediate measurements. The same Hanken Grotesk font now ships only
  its used 400 through 700 weight range, including 450 headings: 23,184 bytes instead of 34,704. All 268
  glyphs, Unicode mappings, vertical metrics and GSUB shaping remain. Axis optimization introduces at most
  one font unit of outline/advance rounding across tested 400/450/500/600/700 instances; no glyphs or used
  weights are removed. The source hash, recipe and complete OFL license accompany the asset. Font family,
  CSS variable, display swap and root history key remain unchanged, with no project dependency added.
  HarfBuzz shaping on eight representative strings at each used weight retains identical glyph selection;
  combined positioning/advance rounding is at most two font units (0.032 px at 16 px). The recipe reproduces
  the transformation; timestamps/table serialization can change bytes, while the SHA identifies this artifact.
  Fresh screenshots preserve heading wraps, spacing and readability. Final default mobile scores are home
  95/100, Terms 97/100 and Privacy 96/100, all CLS 0; scripts are 196,142 bytes. Ten browser page checks and
  four-width anchors, native disclosures and reduced-motion checks pass without errors/failures or overflow.
  Complete new task/full gates pass; fresh exact-head CI remains required.

- T4 task gate: final grouped-shell/font source is frozen. Lint, typecheck and production build pass;
  236 files / 1,871 unit/database tests pass (581.16 seconds). Independent standards/spec source and
  fresh desktop/phone visual reviews pass without findings. The full synthetic reset/book/browser gate
  completes T2; no source changes occur after these measurements.

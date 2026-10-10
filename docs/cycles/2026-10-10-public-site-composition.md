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
4. Preserve all claims, captured numbers, routes, consent/legal wording, session dispatch and tenant behavior.
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

New product features, accounting changes, data capture/regeneration, auth or legal changes, pricing, traction,
analytics, provider affiliation, hosted configuration and startup application submission.

## Assumptions

This is an explicitly requested visual follow-up within the owner's previously approved scope and merge
authorization. Existing capture evidence remains current because the book/UI feature behavior is unchanged.

## Gate re-openers

New dependency or motion piece, schema/auth/PII/accounting change, paid model call, real client data, production
data/configuration writes or new capability claims.

## Tasks

- [x] T1 Redesign and iterate the public composition: stronger opening, useful source/close/report proof, genuine
  evidence and full-view disclosures; reuse tokens, saved captures, money formatter and approved motion.
- [x] T2 Verify and prepare release: complete gates, independent reviews, final screenshots/Lighthouse and accurate
  cycle/PR evidence. Exact-head CI and owner-authorised merge are subsequent release gates tracked in Ship Notes.
  Depends on T1; no changed deck claim is expected.

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
  Phone headings, supporting copy and spacing are tighter. No assets, product claims or dependencies changed.
- T1 iteration: five visual rounds improved contours, headline balance, close detail scale, caption/navigation
  accuracy, phone length and desktop total legibility. The headline remains plain semantic text; CSS balances
  its lines. Separate standards/spec reviews clear the final source and desktop/phone production captures.
  All ten public page captures have no console/resource errors; anchors work without overflow at 1440, 1024,
  768 and 390 px, and reduced motion disables arrival/check animations. The unchanged legal/auth captures also
  pass independent visual review.
- T1 gate: lint and typecheck pass; 226 files / 1,540 tests pass (337.48 seconds); production build passes.
  Complete book/browser gates and Lighthouse remain the T2 release evidence.

- T2: all required local gates complete on the unchanged T1 runtime. Final production captures, complete desktop
  and phone disclosures, keyboard links, reduced motion and trial acknowledgement are inspected. The React
  checklist and separate standards/spec reviews pass with no unresolved visual or source finding. No routes,
  setup instructions, environment variables or capability claims changed, so the existing README remains true.

## Verification

### Verified locally: b334875d7bcc8641f31a5d7cc472ab9834445b0d, 2026-10-10

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

## Ship Notes


- Deck review: no deck change. Both audience decks still agree with uploaded files and registry-backed coverage,
  human approval of AI suggestions, source traceability, close controls, derived reports and Excel/PDF exports.
  The paper/ledger composition borrows their drawing grammar without importing illustrative charts or loops.
- Release: open a draft PR to main with final highlights, then add the e2e label and mark ready. Require check
  and e2e success on the exact pushed head before the owner-authorised merge. No preview or separate promotion.
- Blast radius: two public presentation components and this record. No auth/schema/accounting/configuration or
  dependency changes; no migrations or operator apply step. Rollback: revert the visual refinement merge.
- Post-merge: confirm the merge deployment succeeds and public home contains the refined illustration/story;
  GET legal/login/trial pages, genuine images, fonts, metadata and icons with verified TLS. Do not create a
  production test account. Signed-in real-firm and build-log checks require the same operator access as before.

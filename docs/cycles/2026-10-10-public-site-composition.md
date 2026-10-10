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
- [ ] Keyboard, semantic headings, image descriptions, native disclosure behavior and reduced motion pass.
  Mobile production-build Lighthouse performance and accessibility each remain at least 95 on all three public pages.
- [ ] Local task/full gates pass; desktop/phone visual iterations and separate standards/spec reviews show no
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
- [ ] T2 Verify and ship: complete gates, independent reviews, final screenshots/Lighthouse, accurate cycle/PR
  evidence, exact-head CI and owner-authorised merge. Depends on T1; no changed deck claim is expected.

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

## Verification

## Ship Notes

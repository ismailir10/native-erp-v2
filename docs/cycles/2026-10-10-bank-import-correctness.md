# Bank import correctness and evidence-backed reconciliation

## Context
The 2026-10-10 review reproduced wrong-currency posting, false duplicate removal, invalid dates, weak MT940 boundaries, and false completeness/reconciliation results. Balanced journals alone cannot prove source interpretation or completeness. This work is independent of PR #134's access/backoffice work.

## Spec
Approval: the user approved the review's three-stage proposal on 2026-10-10: “okay get them done … review your work, iterating”. This cycle records that authorization; no repeat approval is required.
- [x] Explicit non-IDR statements cannot be rounded into IDR journals; invalid calendar dates cannot move months.
- [x] Each MT940 block retains and validates its own opening, closing, currency and sequence before merging.
- [x] Distinct same-date/same-amount transactions survive deduplication; ambiguous overlaps are refused before writes with actionable guidance.
- [x] Printed totals remain independent evidence; conflicting totals never become a clean completeness PASS through repair.
- [x] Persist structured source validation and provenance, including declared versus inferred coverage, with imports. Unknown, incomplete and conflict are not PASS.
- [x] Month-end bank controls require coverage through the closing date and select an appropriate balance checkpoint.
- [x] Ambiguous dates and malformed dual-sided amounts require resolution, without silent guesses; OCR truncation cannot be accepted unnoticed.
- [x] Add adversarial regression/mutation coverage across source → parser → persisted journal → controls; retain all existing accounting invariants.

**Non-goals:** tenant/auth/backoffice changes; new banks; bank FX posting; real paid AI calls; production migrations/deployment; obtaining confidential bank statements without an authorized source.
**Assumptions:** keep existing readers and bigint arithmetic; use existing mapping/re-upload flows for ambiguity; draft PR to main. Synthetic adversarial corpus ships now; externally sourced anonymized bank-issued holdouts remain explicitly identified as unavailable, not invented.
**Authorized design changes:** revise the earlier “running chain wins over closing header” policy so contradictions stay unresolved; add an additive JSON validation/provenance column if needed, with backward-compatible reads and explicit legacy uncertainty. No new dependency or AI spending is planned. Deck claims about automatic verification will be reviewed.

## Tasks
- [x] T1 Strict source interpretation — currency, calendar dates, MT940 block integrity; regression cases fail before writes.
- [x] T2 Conservative duplicate identity — preserve exact idempotence and twins; reject ambiguous overlap, retain distinct balance-supported transactions.
- [x] T3 Source validation and reconciliation — preserve independent totals and coverage provenance, persist validation, correctly reconcile sparse balances and partial periods; ambiguity/OCR guards.
- [x] T4 Adversarial corpus and release review — mutations, full accounting and browser gates, review fixes, docs/deck claims, draft PR and CI.

## Implementation
- Plan: T1's MT940 reader and currency/calendar validation delegated as independent parser slices under the build skill; driver owns shared types/integration, T2/T3, review and all DB/full-suite gates. No concurrent DB reset suites. T4 reviews the integrated result.

- T1: `lib/import/parsers/*`, `mapped.ts`, `normalize.ts`, `types.ts`, `app/actions.ts` and reader regressions — strict currency preflight and calendar validation across native/generic/PDF/remembered readers; exact MT940 block totals, mandatory boundaries, currency/date/page continuity; bank-only amount grammar and dual-side refusal. Generic ambiguous dates route to explicit column mapping.
- T2: `dedupe.ts`, `transfer-guard.ts`, `pipeline.ts`, `validation.ts`, `revalidate.ts`, additive Prisma migration and identity/race regressions — exact source hashes establish re-upload identity. Cross-source matching requires unique balance evidence; cycles, unknown balances and ambiguous overlaps refuse before writes. Existing transfer counterparts are locked and rechecked before any journal writes.
- T3: `lib/controls/*`, `lib/reports/status.ts`, `lib/ocr/*`, OCR review UI and source/controls regressions — nullable versioned `StatementImport.sourceValidation`, preserved printed balances, declared/inferred provenance, shared coverage/checkpoint/handoff checks for reports and close. Strict legacy attestation can revalidate exactly matching complete rows without changing journals. OCR requires closing evidence and refuses malformed/oversized output; unresolved missing amounts refuse the whole bank import.
- T4: `tests/unit/statement-mutations.test.ts`, `e2e/bank-source-integrity.spec.ts`, demo/docs and review screenshots — deterministic BCA/XLSX mutation corpus (20 positive + 130 corrupted files), source-to-journal/control DB regressions, transfer race barrier, browser date-order and conflicting-closing flows. Demo and accounting rules now describe source reviews honestly.
- Review iteration: caught invalid-date/layout fallback bypasses, PDF currency-column bypass, PDF administrative numbers misread as money, false completeness across adjacent slices, missing intermediate monthly checkpoints, repeated-fee hash collisions after balance cycles, and stale transfer pairing. Each has a regression case.
- Post-draft T3 review: reproduced false PASS with a duplicate-only overlapping source that inflated its printed opening while keeping every closing correct. Opening checkpoints now compare against the ledger before the source period, and same-start printed openings compare with each other. Openings predating the entity books stay REVIEW instead of assuming a zero prehistory. Independent review added the different-start boundary regression. No journals are rewritten.
- Gate strategy: independent parser slices ran focused units; the integrated working tree runs the full lint/type/test gate before task commits, because identity and persisted evidence share the import boundary. Database reset suites run serially; browser uses the separate local demo database.

## Verification

- Initial full-suite iterations exposed changed fixture assumptions and reader regressions; these were investigated rather than skipped.
- Focused integration pass: 8 DB files, 37 tests passed (source validation, identity, transfer race, OCR, opening, combined PDF, repair and demo).
- Mutation corpus: 150 tests passed, including exact bigint values above JavaScript's safe integer range.
- Production build passed; demo reset and independent `verify:books`: `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- Final integrated lint and typecheck: both exited 0. Focused review gate: 7 files / 149 tests passed.
- Full unit/database/ground-truth gate, final output:
  ```text
   Test Files  213 passed (213)
        Tests  1696 passed (1696)
     Duration  592.90s
  ```
- Full browser gate, final output: `71 passed (9.1m)`; no skipped tests. This includes date-order mapping, contradictory closing, locked PDF import, investor close and existing access boundaries.
- Final production rebuild passed after the OCR copy review. Lint/typecheck were rerun successfully for that wording change. Inspected OCR at 1440×900 and 375×812: required closing visible, import disabled while absent, no page overflow. Synthetic screenshots are in `docs/reviews/bank-import-correctness/`.
- Review changed the OCR notice from an incorrect count of unproven transaction rows to checks on dates, amounts or balances; the missing closing is now described accurately.
- Opening-check follow-up: the two new adversarial cases failed before the fix (`expected PASS to be FAIL`); focused verification after boundary review: 3 files / 22 tests passed. Final follow-up lint/typecheck/build passed; full gate: 213 files / 1,700 tests passed in 638.18s. Independent books check remained 1,765 PASS. Fresh-server browser run: 70 passed, one existing document-upload pause assertion timed out while its fifth upload was still running under concurrent test load. After the final rebuild, the entire document workspace spec passed (3 tests, 43.6s), without code changes or skipped assertions. CI repeats both full browser modes on the final commit. Inspected the revised REVIEW message at desktop and phone widths; no overflow (`bank-source-review-*.png`).
- Browser gate follow-up: CI on `90475e9` passed all unit/DB tests, build and books verification, then 70 browser cases passed and the final firm-wide answer exceeded its default 5-second assertion while still displaying `Memeriksa…`. The local document-upload timeout likewise captured its fifth upload still running. Both initial asynchronous waits now allow 30 seconds, retaining every outcome assertion and zero retries. Lint/typecheck passed; full fresh-server browser rerun: **71 passed (7.8m)**. Application code is unchanged from the 1,700-test passing commit.
- GitHub CI: [PR #137 checks](https://github.com/ismailir10/accounting-erp/pull/137/checks) record the final release status. Superseded runs were cancelled during review; the final follow-up commit runs every gate, including both browser modes.

## Ship Notes
- Migration: additive nullable JSONB column `StatementImport.sourceValidation`; no data rewrite/backfill and no journal migration. Deploy through the normal reviewed PR process; no production migration executed in this session.
- No new dependencies, environment variables, paid AI calls or tenant/auth/backoffice changes. Runtime uses local PostgreSQL 16, local Supabase Auth and installed Chromium.
- Existing legacy/derived/inferred sources can now show REVIEW; printed conflicts show FAIL. Exact complete legacy re-upload can attest matching financial rows; ambiguous or conflicting sources require explicit correction/removal in an open period. Historical locked journals are never rewritten.
- Rollback: revert application changes; the nullable column can remain unused. Do not drop financial imports or alter journals as a rollback shortcut.
- External anonymized bank-issued holdouts were unavailable. Synthetic coverage is deliberately not represented as external real-world validation.
- Draft PR: https://github.com/ismailir10/accounting-erp/pull/137, independent of #134. No merge or production deployment performed.
- Deck claims reviewed in all three HTML files: source interpretation/completeness (kantor 1/3/5/6, perusahaan 3/4), bank formats/count and Rupiah limit (kantor 5, perusahaan 4/13), close/conflict behavior (kantor 5/11, perusahaan 11), multi-currency entry route (kantor 13, perusahaan 13), OCR limitations/data flow (kantor 8/16, perusahaan 12), and illustrative demo numbers. Counts, traceability and accounting figures remain valid.
- Updated kantor slides 1/5/6/13 and perusahaan 3/4/13 to describe checks rather than unconditional proof, state Rupiah bank imports and the ledger route for FX, and remove the claim that an explanatory note can clear a source balance conflict. Chooser retains slide counts and drops stale PDF byte-size labels. Regenerated both downloadable PDFs.
- Inspected every changed slide at 1440×900 and 375×812; no page/slide overflow, copy wraps cleanly. Wide source tables retain their existing internal scroll and phone hint. Captures live in `docs/reviews/bank-import-correctness/deck-*.png`.

## Merge integration review

- User authorized merge after checks. Integrated main through `1ce59dd` (tenant/access and shared workflow). Only generated deck PDFs conflicted; regenerated from merged HTML, preserving source-evidence limits and the new roles. Reviewed the automatic merges in import actions, OCR review, controls and Prisma; both sets of behavior remain intact.
- Local lint, fresh typecheck and production build passed; 229 test files / 1,832 tests passed in 633.42s. Independent books verification: 1,765 PASS. Initial standalone typecheck hit stale generated Next types for the removed auth route; the production rebuild regenerated those types and the standalone rerun passed.
- Re-inspected the conflicting-source controls on desktop and 390px phone: FAIL stays visible, close remains disabled, no horizontal overflow. Refreshed screenshots; combined deck limits slides inspected at desktop/phone, regenerated PDFs have 17/14 pages and retain Rupiah limits and owner roles.

### Verified locally — a74593a, 2026-10-10
- Gate: lint, fresh typecheck, production build, workflow sync check and CI helper syntax check passed. Unit/database suite: `229 passed (229)` files, `1832 passed (1832)` tests, `633.42s`. `verify:books`: `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.` Full Playwright: `84 passed (11.2m)`, no retries/skips. The final main update changes CI/workflow files only; application, package, schema and test inputs match the full local run.
- App: fresh production server at http://localhost:3200 with local PostgreSQL, Supabase Auth, Mailpit and synthetic demo members.
- Walked: currency/date refusal and date-order mapping; conflicting printed balance remains visible and blocks close; locked PDF and MT940 imports; complete investor import/review/report/close flow; invitations, roles, tenant isolation, support session and expired-trial restrictions — all passed.
- Console/network: Next logs occasional `destination stream closed early` when tests navigate away from streamed routes; no failed user-flow assertions. PostgreSQL client-query deprecation warning remains upstream.
- Screenshots: refreshed `bank-source-date-order.png`, `bank-source-closing-conflict.png`, `bank-source-closing-conflict-mobile.png`; inspected controls at 1440px and 390px, combined deck slides at desktop/phone. No clipping or horizontal overflow.
- Highlight: `docs/reviews/bank-import-correctness/bank-source-closing-conflict.png` and `bank-source-closing-conflict-mobile.png` (uploaded as pinned PR assets).
- Rounds: one integration round; regenerated conflicting PDF artifacts and refreshed stale generated Next types. No application fixes needed after combining main.
- Not checked: external bank-issued holdouts remain unavailable. Private GitHub PR image rendering cannot be inspected without a browser login; uploaded assets and pinned links are retained in the PR. Production authenticated checks require production access; never use local fixture credentials there.

## Final automated review follow-up

- [x] R1: let a uniquely matching complete legacy statement reach attestation before cross-source ambiguity refusal; preserve conservative identity and immutable journals.
- [x] R2: keep an unreviewed OCR model period inferred so it cannot establish complete source coverage.
- Plan: R1 legacy identity and R2 OCR provenance are independent worker slices; driver reproduces the regressions, serializes DB tests, reviews the combined changes, runs full verification and handles merge. Both findings arrived on the ready PR while CI ran; merge is paused until they are resolved.

- Reproduced both failures before fixing: exact sparse/cyclic legacy uploads failed row-level identity; an OCR model-expanded month became DECLARED coverage. Focused regressions passed after fixing. Added rejection cases for partial ownership, altered stored descriptions with stale hashes, and explicitly unverified source periods, plus a real MT940-shaped sparse-balance reupload.
- Review: separate spec and standards reviewers found no blockers. Whole-source legacy identity requires one complete unchanged owner and clean original source validation; attestation rechecks under the account lock and updates metadata only. OCR model period dates remain traceable but cannot establish full coverage.

### Verified locally — ca84d96, 2026-10-10
- Gate: lint, typecheck, production build, workflow sync and diff checks passed. Unit/database: `230 passed (230)` files, `1839 passed (1839)` tests in `639.57s`. Books: `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.` Full browser suite: `84 passed (11.2m)`, no retries/skips.
- App: fresh production build with local PostgreSQL, Supabase Auth and synthetic members; browser suite on port 3200, final visual inspection on port 3210.
- Walked: full import/review/report/close, malformed source refusal, mapping, locked periods, tenant/access flows; all passed. Six legacy identity cases preserve financial records or refuse unsafe matches. OCR expanded-header regression keeps both controls REVIEW.
- Console/network: same navigation stream-close warnings and upstream PostgreSQL query deprecation; no failed assertions.
- Screenshots/highlights: refreshed and inspected `docs/reviews/bank-import-correctness/bank-source-review-desktop.png` and `bank-source-review-mobile.png` at 1440px/390px. Unverified-period copy visible, no horizontal overflow or clipping.
- Rounds: one final review round resolving R1 and R2; no additional blockers from independent spec/standards review or final gate.
- Not checked: external anonymized bank holdouts unavailable; private PR image rendering and authenticated production checks require access not available here.

### Verified locally — 6cd972b, 2026-10-10
- Integrated main through `1d3ef98` (#141 default-template auth links), with no conflicts or bank-code changes. Independent integration review found no blockers.
- Gate: lint, typecheck, production build and diff checks passed. Unit/database: `231 passed (231)` files, `1841 passed (1841)` tests in `397.90s`. Books: `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.` Full browser suite: `85 passed (9.2m)`, no retries/skips.
- App/walk: fresh production build and synthetic local data; both auth-link shapes, import/review/report/close, malformed-source refusal, mapping, locked periods, roles and tenant isolation passed.
- Setup correction: initial integrated browser runs exposed local auth verification URLs outside the gateway route, then unreadable public email templates after container recreation. Set local GoTrue verification paths to `/auth/v1/verify`, made public templates readable, and retained local service proxy exclusions. Focused auth suite then passed 2/2 before the successful full 85-case rerun. No application/test assertions changed.
- Console/network: previously observed navigation stream-close and PostgreSQL deprecation warnings only; no failed assertions in the completed final run.
- Screenshots/highlights: refreshed and inspected `bank-source-review-desktop.png` and `bank-source-review-mobile.png` at 1440px/390px on the combined build; readable warnings, no horizontal overflow.
- Rounds: one integration round, followed by local setup diagnosis and successful auth/full browser verification.
- Not checked: external bank holdouts, private PR image rendering, private deployment logs and signed-in production remain unavailable. Local environment startup corrections saved in its configuration draft; publication is separate from the code release.

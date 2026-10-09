# Deck PDF download, and 2024 PSAK numbers in the app

## Context
Two requests from the owner after the deck rebuild (`2026-10-08-deck-rebuild.md`):
1. **"On /deck, give a PDF download button, make sure the PDF version also looks good."** Today a reader has to print the deck to PDF
   themselves, and the result depends on their browser (margins, headers, a count-up caught mid-flight).
2. **"Fix the PSAK numbering in the app too."** Since 1 January 2024 IAI numbers PSAK by source: 1xx for IFRS-based, 2xx for IAS-based
   ([IAI: Perubahan Penomoran PSAK dan ISAK](https://web.iaiglobal.or.id/assets/files/file_publikasi/Perubahan_Penomoran_PSAK_ISAK_dalam_SAK_Indonesia.pdf)).
   The decks use the new numbers; the app still shows the old ones: PSAK 16 (now 216), PSAK 24 (219), and in hints and comments PSAK 1
   (201), 3 (234), 10 (221), 46 (212), 72 (115). PSAK 109 and 116 are already the new numbers. An auditor reading "PSAK 24" on a CALK or a
   journal memo in 2026 sees an outdated reference.

## Spec
Approval: the owner's request in-session ("get them done"). No schema change, no new dependency, no accounting rule or number changes.

- [ ] **PDF files:** `public/deck/buku-kantor-akuntan.pdf` (17 pages) and `public/deck/buku-perusahaan.pdf` (14 pages), one 16:9 page per
  slide, rendered by Chromium from the decks themselves, fonts embedded, final numbers (no animation state), links clickable.
- [ ] **Reproducible:** `npm run deck:pdf` regenerates both from `public/deck/*.html` (Playwright, already a dev dependency), so a deck edit
  and its PDF ship together.
- [ ] **Download buttons:** each card on `/deck` has *Unduh PDF* next to *Buka presentasi* (same-origin `download` link with the page count);
  inside a deck the controls carry a PDF link too. No nested links; keyboard and screen reader friendly.
- [ ] **PDF reviewed page by page** at reading size; anything that prints worse than the screen is fixed in the print CSS.
- [ ] **PSAK numbers:** every user-facing string (pages, components, CALK and report text, workbooks, hints, journal memos) and the docs
  that describe the product (README, `accounting-rules`, QA plan) use the 2024 numbers; code comments follow. Tests that assert the
  text are updated. History (`docs/cycles/`) is left as written.
- [ ] Gates: `npm run lint && npm run typecheck && npm test`, then `npm run build && npm run verify:books && npm run test:e2e`.

**Non-goals:** changing posted journal memos already in a database (they keep the text they were posted with), SAK EP chapter references
("SAK EP Bab 29" is a chapter, not a PSAK), new deck content.

**Assumptions**
1. Committing two generated PDFs (~1–2 MB each) is acceptable; they are static assets next to the HTML they come from.
2. A new journal memo reads *Imbalan kerja PSAK 219 per …*; older entries keep *PSAK 24*. Nothing matches on the memo text (checked).

## Tasks
- [ ] T1 Deck PDFs + `deck:pdf` script + download buttons — accept: both PDFs reviewed page by page; `/deck` buttons download; CSP server clean.
- [ ] T2 PSAK 2024 numbering in app, lib, tests, docs — accept: grep finds no old numbers outside `docs/cycles/`; gates green.

## Implementation

## Verification

## Ship Notes

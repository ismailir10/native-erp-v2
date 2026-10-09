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

- [x] **PDF files:** `public/deck/buku-kantor-akuntan.pdf` (17 pages) and `public/deck/buku-perusahaan.pdf` (14 pages), one 16:9 page per
  slide, rendered by Chromium from the decks themselves, fonts embedded, final numbers (no animation state), links clickable.
- [x] **Reproducible:** `npm run deck:pdf` regenerates both from `public/deck/*.html` (Playwright, already a dev dependency), so a deck edit
  and its PDF ship together.
- [x] **Download buttons:** each card on `/deck` has *Unduh PDF* next to *Buka presentasi* (same-origin `download` link with the page count);
  inside a deck the controls carry a PDF link too. No nested links; keyboard and screen reader friendly.
- [x] **PDF reviewed page by page** at reading size; anything that prints worse than the screen is fixed in the print CSS.
- [x] **PSAK numbers:** every user-facing string (pages, components, CALK and report text, workbooks, hints, journal memos) and the docs
  that describe the product (README, `accounting-rules`, QA plan) use the 2024 numbers; code comments follow. Tests that assert the
  text are updated. History (`docs/cycles/`) is left as written.
- [x] Gates: `npm run lint && npm run typecheck && npm test`, then `npm run build && npm run verify:books && npm run test:e2e`.

**Non-goals:** changing posted journal memos already in a database (they keep the text they were posted with), SAK EP chapter references
("SAK EP Bab 29" is a chapter, not a PSAK), new deck content.

**Assumptions**
1. Committing two generated PDFs (~1–2 MB each) is acceptable; they are static assets next to the HTML they come from.
2. A new journal memo reads *Imbalan kerja PSAK 219 per …*; older entries keep *PSAK 24*. Nothing matches on the memo text (checked).

## Tasks
- [x] T1 Deck PDFs + `deck:pdf` script + download buttons — accept: both PDFs reviewed page by page; `/deck` buttons download; CSP server clean.
- [x] T2 PSAK 2024 numbering in app, lib, tests, docs — accept: grep finds no old numbers outside `docs/cycles/`; gates green.

## Implementation
- **T1:** `scripts/deck-pdf.ts` (`npm run deck:pdf`) serves `public/` on a free local port and prints each deck with Playwright's Chromium at
  1600 × 900, `reducedMotion: "reduce"` (no entrance or count-up state), fonts awaited, backgrounds on. Output:
  `public/deck/buku-kantor-akuntan.pdf` (17 pages, 1,3 MB) and `public/deck/buku-perusahaan.pdf` (14 pages, 1,1 MB), Hanken Grotesk embedded
  and selectable, the right-jet.com buttons stay links. `/deck` cards became a `div` whose title link covers the card (so the whole card still
  opens the deck, without nesting links), with *Buka presentasi* and *Unduh PDF* (`download`) above it; each deck's controls show a PDF link
  (`data-pdf` on `<body>`). The print CSS needed no change: page by page the PDF matches the screen.
- **T2:** perl over every file outside `docs/cycles/` and the dated QA report: PSAK 16 → 216, 24 → 219, 1 → 201, 3 → 234, 10 → 221, 46 → 212,
  72 → 115 (word-bounded, so 109/116 untouched). User-facing: the Aset Tetap page description and field help, the Imbalan Kerja page title,
  module description and empty state, the close control title *Imbalan kerja (PSAK 219) = valuasi*, the tax workpaper line, the down-payment
  hint, the benefits journal memo. Docs: README rows, `accounting-rules` 5d/5g/5j, QA test plan, Prisma doc comments (no migration).
  Tests and e2e that assert the memo and heading follow. README's onboarding line now says a Saldo Awal difference goes to 3290 and opens a
  Temuan (ADR 0012) instead of "plug to 3200".
- Also: the unused `catch (e)` binding in `deck.js` (lint warning from the previous deck PR).

## Verification
- PDFs rendered at 96 dpi and reviewed page by page (all 31): final numbers, dark slides keep their background, footer and page counter on
  every page, nothing clipped; `pdffonts` shows the font embedded with Unicode maps.
- Production-equivalent server (exact rewrites + CSP): both *Unduh PDF* buttons and the in-deck PDF link download the files; clicking a card
  still opens its deck; tab order brand → deck → Buka presentasi → Unduh PDF; no console or CSP errors at 1440 and 390 px.
- `npm run lint` clean; `npm run typecheck` clean; `npm test` 185 files / 1217 tests passed; `npm run build` ok; `npm run verify:books`
  ALL PASS (1765 checks); `npm run test:e2e` 58 passed against the local Supabase Auth stack (`npm run auth:local`, Docker).
  The sandbox still can't download `xlsx` from cdn.sheetjs.com, so these ran with the npm registry's `xlsx@0.18.5` installed locally
  (package.json and the lockfile untouched); CI runs the pinned version.

## Ship Notes

# 9fin-style interface in Wise colours

## Context
The user wants Buku to look like 9fin (credit-intelligence platform: dark app chrome, hairline grid borders, sharp
corners, monospace uppercase micro-labels with a small square marker, dense data tables) while using Wise's colour
palette. Today's look is Stripe-dashboard (light canvas, navy text, strong blue), written into `ui-rules` and CLAUDE.md §4.
The theme is almost entirely token-driven (`app/globals.css`), so the change is mostly tokens plus a few shared components.

Palette source: Wise's own published design tokens, `@transferwise/neptune-tokens` 8.26.0, personal theme (read, not installed).

## Spec
Tokens (`app/globals.css`)
- [ ] Canvas `#F6F7F5` (Forest Green 4% on white), cards white, text `#0E0F0C` / secondary `#454745` / muted `#6A6C6A`,
      borders `#0E0F0C1F`-equivalent hairline (`#E1E2DF`), input `#D3D5D0`.
- [ ] `--primary` = Wise interactive primary **Forest Green `#163300`** (text, links, rings, subtle tints) — every existing
      `text-primary` stays readable. New `--brand` = **Bright Green `#9FE870`** with `--brand-foreground` `#163300`,
      used only as a fill (primary button, active nav item, logo). Bright Green is never text on white.
- [ ] Status tokens from Wise sentiments: pass `#054D28` on `#E2F6D5`, review `#4A3B1C` on `#FFF7D7` (accent `#FFD11A`),
      fail `#CB272F` on `#FBEAEA`. Labels stay icon + word (rule 6).
- [ ] Radius 4px (9fin sharp) instead of 8px; cards keep a hairline border, no shadow.
- [ ] Chart palette forest-led, validated with the `dataviz` skill's validator (≥ 3:1 on white for each series used).

Components
- [ ] **Sidebar = dark app chrome**: Forest Green background, off-white text, active item Bright Green fill with Forest
      text, group labels monospace uppercase. Everything inside stays legible (no `text-muted-foreground` on dark).
- [ ] **Primary button** = Bright Green fill + Forest text (Wise signature); outline/ghost unchanged in shape, forest text.
- [ ] **9fin micro-labels**: table headers, sidebar group labels, `Stat` labels and page-header eyebrows in monospace
      uppercase 11px with letter-spacing; `NextStep` gets the small square marker instead of the tinted blue box.
- [ ] `BrandMark` Bright Green square with Forest "B". Login page follows the same chrome.
- [ ] `ui-rules` skill "Look" section and CLAUDE.md §4 row rewritten to the new standard (9fin structure, Wise colours,
      token names, "Bright Green is fill-only").

Checks
- [ ] Every text/background pair used by tokens ≥ 4.5:1 (listed with ratios in Verification).
- [ ] Screenshots desktop + 390px of Beranda, Laporan Keuangan, Tutup Buku (with Tinjauan AI), login; no horizontal scroll.
- [ ] Gates: lint, typecheck, test, build, `verify:books` ALL PASS, `test:e2e` green (no copy or role changes, so selectors hold).

**Gate-reopeners:** none — no schema, dependency, AI or accounting change. This does replace the documented UI
standard (`ui-rules`, CLAUDE.md §4), which this approval covers.

**Non-goals:** dark mode for the content area; layout, navigation or copy changes; new fonts (monospace = system
`ui-monospace`, Inter stays); logo redesign beyond colour; marketing pages.

**Assumptions:**
1. "Like 9fin" = its structure and typography (dark chrome, hairlines, sharp corners, mono uppercase labels, dense
   tables) with a light content area for long accounting reading — not a fully dark app.
2. Wise's primary *text/interactive* colour is Forest Green, Bright Green is its signature *fill*; that split is taken
   from Wise's own token mapping (`interactive-primary` vs `interactive-accent`).
3. Monospace uses the system stack (SF Mono / Consolas / Menlo) to avoid a new font dependency.
4. Status colours follow Wise sentiments even though "pass" green sits close to the brand green; the icon + word keeps
   them distinct.

## Tasks
- [ ] T1 Tokens + contrast table + docs (`app/globals.css`, `ui-rules`, CLAUDE.md §4) — accept: contrast ratios computed and listed; lint/typecheck/test green.
- [ ] T2 Shared components: sidebar chrome, button, brand mark, table head, `Stat`/`NextStep`/`PageHeader` micro-labels, login — accept: screenshots desktop + 390px look right; no illegible text on dark chrome.
- [ ] T3 Charts palette (dataviz validator) + visual pass over every main page + end-of-cycle gates — accept: validator passes; `build`, `verify:books`, `test:e2e` green.

## Implementation
## Verification
## Ship Notes

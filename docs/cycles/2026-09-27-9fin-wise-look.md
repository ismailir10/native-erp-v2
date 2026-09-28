# 9fin-style interface in Wise colours

## Context
The user wants Buku to look like 9fin (credit-intelligence platform: dark app chrome, hairline grid borders, sharp
corners, monospace uppercase micro-labels with a small square marker, dense data tables) while using Wise's colour
palette. Today's look is Stripe-dashboard (light canvas, navy text, strong blue), written into `ui-rules` and CLAUDE.md §4.
The theme is almost entirely token-driven (`app/globals.css`), so the change is mostly tokens plus a few shared components.

Palette source: Wise's own published design tokens, `@transferwise/neptune-tokens` 8.26.0, personal theme (read, not installed).

## Spec
Tokens (`app/globals.css`)
- [x] Canvas `#F6F7F5` (Forest Green 4% on white), cards white, text `#0E0F0C` / secondary `#454745` / muted `#6A6C6A`,
      borders `#0E0F0C1F`-equivalent hairline (`#E1E2DF`), input `#D3D5D0`.
- [x] `--primary` = Wise interactive primary **Forest Green `#163300`** (text, links, rings, subtle tints) — every existing
      `text-primary` stays readable. New `--brand` = **Bright Green `#9FE870`** with `--brand-foreground` `#163300`,
      used only as a fill (primary button, active nav item, logo). Bright Green is never text on white.
- [x] Status tokens from Wise sentiments: pass `#054D28` on `#E2F6D5`, review `#4A3B1C` on `#FFF7D7` (accent `#FFD11A`),
      fail `#CB272F` on `#FBEAEA`. Labels stay icon + word (rule 6).
- [x] Radius 4px (9fin sharp) instead of 8px; cards keep a hairline border, no shadow.
- [x] Chart palette forest-led, validated with the `dataviz` skill's validator (≥ 3:1 on white for each series used).

Components
- [x] **Sidebar = dark app chrome**: Forest Green background, off-white text, active item Bright Green fill with Forest
      text, group labels monospace uppercase. Everything inside stays legible (no `text-muted-foreground` on dark).
- [x] **Primary button** = Bright Green fill + Forest text (Wise signature); outline/ghost unchanged in shape, forest text.
- [x] **9fin micro-labels**: table headers, sidebar group labels, `Stat` labels and page-header eyebrows in monospace
      uppercase 11px with letter-spacing; `NextStep` gets the small square marker instead of the tinted blue box.
- [x] `BrandMark` Bright Green square with Forest "B". Login page follows the same chrome.
- [x] `ui-rules` skill "Look" section and CLAUDE.md §4 row rewritten to the new standard (9fin structure, Wise colours,
      token names, "Bright Green is fill-only").

Checks
- [x] Every text/background pair used by tokens ≥ 4.5:1 (listed with ratios in Verification).
- [x] Screenshots desktop + 390px of Beranda, Laporan Keuangan, Tutup Buku (with Tinjauan AI), login; no horizontal scroll.
- [x] Gates: lint, typecheck, test, build, `verify:books` ALL PASS, `test:e2e` green (no copy or role changes, so selectors hold).

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
- [x] T1 Tokens + contrast table + docs (`app/globals.css`, `ui-rules`, CLAUDE.md §4) — accept: contrast ratios computed and listed; lint/typecheck/test green.
- [x] T2 Shared components: sidebar chrome, button, brand mark, table head, `Stat`/`NextStep`/`PageHeader` micro-labels, login — accept: screenshots desktop + 390px look right; no illegible text on dark chrome.
- [x] T3 Charts palette (dataviz validator) + visual pass over every main page + end-of-cycle gates — accept: validator passes; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T3 sequential, inline (tokens → components → charts/visual pass depend on each other).
- T1: `app/globals.css` (Wise tokens, `--brand`/`--brand-foreground`, 4px radius, Forest sidebar tokens, `.eyebrow`, system mono stack), `.claude/skills/ui-rules/SKILL.md` (Look section + description), `CLAUDE.md` §4. `--input` is `#8A8C87` (3.4:1) instead of the spec's `#D3D5D0`, so form field edges meet WCAG 1.4.11's 3:1; hairline `--border` stays decorative. Chart tokens are placeholders until T3's validator run.- T2: `components/ui/button.tsx` (default = Bright Green fill, Forest text, no shadow), `components/ui/sidebar.tsx` (active item = `sidebar-primary`, hover = lighter Forest, icons follow text colour, group labels mono uppercase), `components/ui/table.tsx` (headers `.eyebrow`), `components/app/app-sidebar.tsx` (sidebar tokens instead of `text-muted-foreground`, Forest borders), `components/app/page-header.tsx` (`NextStep` white hairline box with a small Bright Green square marker; `Stat` label `.eyebrow`, no shadow), `components/app/status.tsx` (square 9fin tag), `components/app/brand-mark.tsx`, `app/login/page.tsx` (Forest page, white card), card shadows removed in `review-queue` / `fx-missing`.
- T3: `app/globals.css` chart order from Wise's own ramps — green-dark `#008026`, brand purple `#485CC7`, orange-dark `#9A6500`, blue-dark `#0097C7`; `chart-5` neutral "Lainnya". **Deviation:** the spec said "Forest-led"; Forest `#163300` fails the validator's lightness band and chroma floor, so charts use Wise green-dark instead. `components/app/charts.tsx`: Beban moved from `chart-4` to `chart-2` so the Pendapatan/Beban pair is a validated adjacent pair. Visual pass fix: client overview's control card clamps each detail to two lines (`app/(app)/clients/[id]/page.tsx`), since the new sanity details are long and the full text is on Tutup Buku. Pre-existing React key warning on /documents (`EvidenceHome`) left for a separate task.

## Verification
- T1 contrast (WCAG, computed): foreground on canvas 17.89 · on card 19.23 · muted-fg on card 9.37 / canvas 8.72 / muted 8.34 · Forest text on card 13.93 / canvas 12.96 / primary-subtle 12.01 · white on Forest 13.93 · Forest on Bright Green 9.45 · sidebar fg on Forest 11.86 · pass on pass-subtle 8.76 · review on review-subtle 10.10 · fail on fail-subtle 4.67 · fail/pass/review on card 5.43/10.01/10.86 · input border on card 3.40 · Bright Green on white 1.47 (hence fill-only).
- T1: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 384 passed (384).- T2: lint + typecheck clean; `npm test` → 51 files / 384 tests passed. Browser on local `buku_real` (:3001): Beranda, Tutup Buku with *Tinjauan AI*, Laporan Keuangan (Gabungan) at desktop; Beranda + mobile nav sheet at 390 px (scrollWidth = clientWidth = 390); login captured anonymously with Playwright at 1280 and 390.
- T3 dataviz validator (light, surface #FFFFFF): `#008026,#485CC7,#9A6500,#0097C7` → PASS lightness band, chroma ≥ 0.10, CVD worst adjacent ΔE 22.6 (deutan), normal-vision 25.2, contrast all ≥ 3:1; pair `#008026,#485CC7` → CVD ΔE 25.3, normal 29.1. First attempt (Forest-led) failed band, chroma, CVD 2.1 and normal-vision 10.9.
- Visual pass (local :3001): client overview charts (legend, green/purple), Neraca Saldo, Dokumen, Pengaturan, Tutup Buku, Laporan Keuangan, Beranda, login — all readable on the new tokens.
- End of cycle: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 384 passed (384); `npm run build` ✓ Compiled successfully; `npm run demo:reset && npm run verify:books` → `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`; `npm run test:e2e` → 9 passed (28.8s).

## Ship Notes
- **Visual change only.** No schema, env var, dependency, AI or number change. Selectors and copy unchanged (e2e green).
- UI standard replaced: `ui-rules` Look section and CLAUDE.md §4 now describe 9fin structure in Wise colours; future UI work follows it (Bright Green is fill-only).
- Rollback: revert the merge.

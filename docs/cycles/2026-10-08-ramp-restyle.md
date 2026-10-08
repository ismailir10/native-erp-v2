# Ramp-style restyle with strong blue

## Context
The app looks like "ledger paper" (PR #119 and earlier): Newsreader serif titles, deep ink-blue `#1F3A8A`, 2px corners, hairline cards.
The owner wants the look of [ramp.com](https://ramp.com/) — large light sans headlines with tight tracking, warm-grey surfaces, near-black ink,
soft 6–16px corners, flat (no shadow/gradient) controls, tinted icon tiles, one loud accent — with **strong blue where Ramp uses its lime-yellow "solar"**.
The design tokens (font, colour, radius) must move with it, so components keep reading tokens and nothing is hard-coded.

What Ramp actually does (measured on the live site, 2026-10-08):

| Thing | Ramp | Buku mapping |
|---|---|---|
| Font | Lausanne (commercial, 400 weight everywhere, 64px/64px h1, -0.01 tracking) | free grotesque neighbour — see Assumption 1 |
| Ink | `#0c0a08` text, `#1a1919` black buttons, muted = ink at 60% | `--foreground` warm near-black, `--muted-foreground` ≈ ink 60% |
| Surfaces | page white, panels `#f4f2f0` (no border, radius ≈ 16), inputs/borders `#d2cecb` | canvas `#F4F2F0`-ish warm grey, white working cards, lighter hairline |
| Accent | solar `#e4f222` fill with dark text; "springLight" `#e4ebf6` icon tiles with `#5683d2` glyph | strong blue fill with white text; pale-blue icon tiles |
| Buttons | 6px (nav) / 8px (hero), 14–16px, no shadow, accent + black pair | same radii, blue primary, ink "dark" variant for the rare second CTA |
| Dark band | `#1a1919` section with `#222` cards, 8px+ radius | sidebar stays light; no dark bands in the app |

## Spec
- [ ] `app/globals.css` tokens carry the new look and nothing else hard-codes it: font stack (`--font-sans`, `--font-display`), warm-neutral palette, strong blue
      `--primary/--brand` (+ `-hover`, `-subtle`), `--ring`, sidebar tokens, `--radius`, chart-1 re-validated.
- [ ] White text on the blue fill ≥ 4.5:1 (target ≥ 5.5:1) and blue as text on white/canvas ≥ 4.5:1; muted text ≥ 4.5:1 on canvas and white. Checked numerically, not by eye.
- [ ] Page titles, `Stat` values and the login heading use the new display treatment (large, regular weight, tight tracking) — no serif left anywhere
      (`Newsreader` removed from CSS and `package.json`).
- [ ] Radii: controls 8px, cards/panels 12px, chips/pills full — via `--radius`, not per-component literals. `rounded-[2px]`-style literals in chart swatches/tooltip arrow stay.
- [ ] shadcn primitives restyled to match (button, badge, card, input, select, tabs, dialog, sheet, popover, dropdown, table, sidebar): flat, no new shadows, visible focus ring in blue.
- [ ] Product components restyled: `BrandMark`, `NextStep`, `Stat`, `StatusPill`, `MethodBadge`, `ScopeBar`, sidebar items, login/auth card. Icon tiles (pale-blue square + blue glyph) used where a card leads with an icon.
- [ ] Every screen reviewed in a real browser at 1280px and 390px: Beranda, client Ringkasan, Impor, Review, Buku Besar, Neraca Saldo, Laporan, Tutup buku, Pengaturan, login.
      Iterate until no screen has clipped text, broken alignment, low-contrast text, or a leftover old-style element.
- [ ] `ui-rules` skill and README/AGENTS mentions of the old look (ink blue, 2px, Newsreader) updated; one ADR records the font substitution and token set.
- [ ] Gates green: `npm run lint && npm run typecheck && npm test`, then `npm run build && npm run verify:books && npm run test:e2e`.

**Non-goals:** dark mode; copy/Bahasa changes; layout or information-architecture changes; new pages; marketing site; animation changes; any report number, query or accounting code.

**Gate-reopeners flagged:** one new npm dependency (a `@fontsource-variable/*` font, replaces `newsreader`); rewrites the Look/Type sections of the `ui-rules` skill.

**Assumptions**
1. **Font.** Lausanne is a paid face we can't ship. Use the closest free self-hosted grotesque. Candidates: Hanken Grotesk, Instrument Sans, Geist, Inter Tight.
   Chosen in T1 by rendering the same page in each: must have tabular numerals (`tnum`) because every amount uses `.num`, and Indonesian text must look good at 14px.
   Default if tied: Hanken Grotesk. Inter is dropped (one family, not two).
2. **Strong blue** = a vivid cobalt around `#2152E8` (exact value fixed by the contrast check in T1), clearly brighter than today's ink blue. Hover darker, tint pale.
3. **"Blue is for things you can do, never for a figure"** stays. Ramp's accent is also action-only on the site, so no conflict.
4. **Surfaces:** warm-grey canvas with white working cards (tables/forms stay white for legibility) rather than Ramp's grey-on-white; hairline borders stay but get softer. No shadows.
5. **Sidebar stays light** (white/paper) with a blue-tint active item; Ramp's black button becomes an `ink` button variant used sparingly, never next to the blue primary on the same row.
6. **Review needs a signed-in session.** Local dev runs on the local Supabase Auth stack (`npm run auth:local`, Docker via colima) with the demo seed admin; the owner then said to review on the PR's preview deploy.
7. Status colours (`pass/review/fail`) keep their meaning; only re-tuned to sit with the warmer neutrals.

## Tasks
- [x] T1 Tokens + font — add the chosen font, drop Newsreader/Inter, rewrite `:root` tokens, `--radius`, `.eyebrow`, display utility; contrast table in Implementation — accept: `npm run build` ok, contrast numbers in doc, app boots with new font
- [ ] T2 shadcn primitives — button (+ `ink` variant), badge, card, input/select/textarea, tabs, dialog/sheet/popover/dropdown, table, sidebar, skeleton — accept: no hard-coded colours, focus ring visible, 390px ok
- [ ] T3 Product components + auth — `BrandMark`, `PageHeader`, `NextStep`, `Stat`, `StatusPill`, `MethodBadge`, `ScopeBar`, workspace overview cards with icon tiles, login/atur-sandi card — accept: components read tokens only
- [ ] T4 Browser review loop — walk every screen at 1280 and 390 (local stack signed in as the demo admin, then the PR's preview deploy), fix findings, repeat — accept: second full pass finds nothing to fix
- [ ] T5 Docs — `ui-rules`, README/AGENTS look lines, ADR 0016 (font + token set) — accept: grep finds no "Newsreader", "ink-blue #1F3A8A", "2px" in docs
- [ ] T6 Gates — full end-of-cycle gates — accept: all green

## Implementation
- Plan: tasks T1–T6 sequential, done inline (one slice touches shared tokens; each task builds on the previous). Full `npm test` (~5 min) run at T1 and at the end; lint + typecheck between UI-only tasks.
- Font: compared Hanken Grotesk, Instrument Sans, Geist, Inter Tight on the same Indonesian copy and amounts (all have `tnum`); Hanken Grotesk chosen (closest to Lausanne's warmth, per Assumption 1).
- T1: `app/globals.css`, `app/icon.svg`, `package.json`/`package-lock.json`, `components/app/page-header.tsx`, `app/login/shell.tsx`, `app/(app)/not-found.tsx` — tokens (warm neutrals, `#2152E8` blue, 8px radius, xl 12px / 2xl 16px), Hanken Grotesk replaces Inter + Newsreader, `.display` and `.icon-tile` utilities. Lockfile edited by hand: a plain `npm install` prunes the rolldown platform bindings (npm bug 4828) and would break Linux CI.
  Contrast (WCAG, computed): white on `#2152E8` 6.11; `#2152E8` on canvas 5.47; muted `#5F5B58` 6.72 white / 6.02 canvas; hover `#1A44C4` with white 7.87; sidebar active text `#1638A8` on `#E6ECFD` 8.21; control border `#8F8A85` 3.42.
  Chart palette `#2152E8,#E0592A,#12876F,#9B4DCA,#6B7280`: dataviz validator — lightness band, CVD (worst adjacent ΔE 8.6), normal-vision floor, contrast all PASS; the only FAIL is the chroma floor of the grey "Lainnya" slot, which is grey by design.

## Verification
- T1: `npm run lint` clean, `npm run typecheck` clean, `npm test` 185 files / 1217 tests passed.

## Ship Notes

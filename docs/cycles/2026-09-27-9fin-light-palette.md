# 9fin palette on a light background

## Context
The previous cycle (`2026-09-27-9fin-wise-look.md`) kept 9fin's structure but coloured it with Wise: Forest Green
chrome, Bright Green buttons. The user finds the Wise green ugly and wants 9fin's colours instead, on a light
background everywhere (including the sidebar). Structure stays: hairlines, sharp 4px corners, mono micro-labels.

The theme is token-driven (`app/globals.css`); no component hard-codes a hex. Only the login page reads a chrome
token (`bg-sidebar`) as a page background.

Palette source: 9fin.com could not be read from the build sandbox (network policy denied the host), so the values
below are a 9fin-inspired approximation — deep navy ink, one strong blue, cool greys — not extracted from 9fin's CSS.
Swapping to exact 9fin values later is a one-file change (`app/globals.css`).

## Spec
Tokens (`app/globals.css`)
- [x] Cool light canvas `#F5F7FA`, white cards, navy ink `#0B1B32`, secondary text `#4B5768`, hairline `#E3E7ED`, input edge `#8792A2` (≥ 3:1).
- [x] `--primary` = strong blue `#1D5BD8` (text, links, rings); `--primary-subtle` `#EDF2FD`.
- [x] `--brand` = the same blue as a fill with white text (primary button, logo, NextStep marker). Green is gone from chrome.
- [x] **Light sidebar**: white, navy text, active item = blue tint with dark-blue text, hover = cool grey.
- [x] Status tokens re-tuned so "pass" green no longer echoes the brand: pass `#0E7A4D`, review `#8A5300`, fail `#C4213A` (+ subtle tints). Icon + word unchanged.
- [x] Chart order blue `#1D5BD8`, orange `#E0592A`, green `#12876F`, violet `#9B4DCA`; `chart-5` neutral "Lainnya". Validated with the dataviz validator.

Components
- [x] Login page uses the light canvas (was the dark chrome colour).

Docs
- [x] `ui-rules` Look section and AGENTS.md §4 row describe the new standard.

Checks
- [x] Every text/background token pair ≥ 4.5:1 (ratios in Verification); input edge ≥ 3:1.
- [x] Screenshots desktop + 390px; no horizontal scroll.
- [x] Gates: lint, typecheck, test, build, `verify:books`, `test:e2e`.

**Gate-reopeners:** none — no schema, dependency, AI or accounting change.

**Non-goals:** layout, navigation, copy or typography changes; dark mode; logo redesign beyond colour.

**Assumptions:**
1. Exact 9fin hex values are unverified (site unreachable from the sandbox); the user approved proceeding ("get it done").
2. "Light background" includes the sidebar (user's answer: light everywhere).
3. Brand fill = primary blue; keeping a separate `--brand` token so components need no edits.

## Tasks
- [x] T1 Tokens + contrast + docs (`app/globals.css`, `ui-rules`, AGENTS.md §4) — accept: every pair ≥ 4.5:1, validator passes, lint/typecheck/test green.
- [x] T2 Login canvas + visual pass + end-of-cycle gates — accept: screenshots readable at 1280 and 390; build, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1 → T2 sequential, inline.
- T1: `app/globals.css` `:root` rewritten (navy ink, blue primary, `--brand` = blue fill with white text, white sidebar with blue-tint active item, re-tuned status, new chart order); header comment updated. `.agents/skills/ui-rules/SKILL.md` Look section + description, AGENTS.md §4 row. `--sidebar-foreground` is `#2A3547` (not `#3B4658`) so the 70%-opacity firm name and email stay ≥ 4.5:1. No component edits needed: every surface reads tokens.
- T2: `app/login/page.tsx` page background `bg-sidebar` → `bg-background` (the sidebar is white now; the login keeps a white card on the light canvas). No other component change needed; sidebar keeps its hairline `border-r`.

## Verification
- T1 contrast (WCAG, computed): foreground on canvas 16.08 · on card 17.25 · muted-fg on card 7.34 / canvas 6.84 / muted 6.53 · primary on card 5.93 / canvas 5.53 / primary-subtle 5.29 · white on primary/brand 5.93 · sidebar fg on white 12.36 (at 75% 5.64, at 70% 4.86) · active nav text on tint 7.30 · hover text 15.64 · pass/review/fail on their tints 4.77/5.74/5.04, on card 5.37/6.33/5.79 · input edge 3.15.
- T1 dataviz validator (light, #FFFFFF): `#1D5BD8,#E0592A,#12876F,#9B4DCA` → ALL CHECKS PASS (worst adjacent CVD ΔE 8.6 protan, normal 27.2, all ≥ 3:1). Pendapatan/Beban pair `#1D5BD8,#E0592A` → CVD ΔE 28.3, normal 37.4. Rejected first try: teal `#0E8A7B` failed the chroma floor.
- T1: lint + typecheck clean; `npm test` → Test Files 53 passed (53), Tests 394 passed (394).
- T2 browser (dev, demo data): Beranda, client overview (charts + legend + table), Tutup Buku, Laporan Keuangan at 1440 and 390 px — `scrollWidth = clientWidth` on every page; login captured anonymously at both widths. Sidebar active item, primary button, NextStep marker, status tags all read on the new tokens.
- End of cycle: lint + typecheck clean; `npm test` → Test Files 53 passed (53), Tests 394 passed (394); `npm run build` ✓ Compiled successfully; `npm run demo:reset && npm run verify:books` → `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`; `npm run test:e2e` → 9 passed (51.7s).

## Ship Notes
- **Visual change only.** No schema, env var, dependency, AI or number change; copy and selectors unchanged (e2e green).
- **Palette values are an approximation** of 9fin (site unreachable from the build sandbox). To match 9fin exactly, edit the `:root` block in `app/globals.css` and re-run the contrast and dataviz checks listed above.
- UI standard updated: `ui-rules` Look section and AGENTS.md §4 now describe 9fin on a light background (one blue, no green chrome).
- Rollback: revert the merge.

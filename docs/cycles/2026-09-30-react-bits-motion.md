# Motion from React Bits (restrained)

## Context
The user asked to use [React Bits](https://reactbits.dev) to improve the UI and to decide what fits. Buku is a daily tool for accountants:
calm, dense, numbers first (9fin look, `ui-rules`). React Bits is mostly showpiece motion — aurora/plasma backgrounds, gradient and
shiny text, glass, cursor trails, 3D carousels — and most of it breaks `ui-rules` "No AI-slop" (no gradients as decoration, no glass,
no sparkle). Used whole-sale it would make the product look less trustworthy, not more.

What *does* fit is motion that carries meaning: where you arrived (a page settles in), what changed (a number counts to its value,
the close-progress bar fills), and what finished (a check draws itself when books are closed). Plus one quiet first impression on the
login page (a hairline dot grid that reacts to the pointer in the brand blue).

Who feels it: every accountant on every navigation (page settle, counters), the investor demo (login, first client overview).

## Spec
- [ ] **Ports, not dependencies.** Four React Bits components ported to plain React + CSS in `components/motion/`, no `motion`/`gsap`/`ogl`
      dependency (their npm deps are ~60–100 KB for effects that need ~2 KB). Each file credits React Bits; the upstream MIT + Commons Clause
      notice lives in `components/motion/REACT-BITS-LICENSE.md` (use inside a product is allowed; the components are not redistributed on their own).
- [ ] **DotGrid** (Backgrounds/DotGrid) → login, lupa sandi, atur sandi (`AuthShell`): hairline-coloured dots, dots near the pointer tint to
      `--primary`. Canvas, `aria-hidden`, `pointer-events: none`, redraws only on pointer movement (no idle rAF loop), colours read from CSS
      tokens (no hex in components). No pointer reaction under `prefers-reduced-motion` or on touch; the static grid stays.
- [ ] **FadeContent** (Animations/FadeContent) → `app/(app)/template.tsx`: each page settles in (opacity + 4px rise, 220 ms) on navigation;
      the auth card does the same. CSS only; none under reduced motion.
- [ ] **CountUp** (TextAnimations/CountUp) → client overview stat tiles (cash, revenue, net profit as compact money; controls passed),
      Beranda "Klien selesai". Money is tweened in **bigint** (`lib/motion.ts` `tweenMinor`, never `Number` on an amount — accounting-rules §Money)
      and formatted with `formatMoneyCompact`, so every frame is a real formatted amount and the last frame is exactly the value.
      Server HTML holds the final value; a counter that hydrates from server HTML does **not** re-animate (no flash of the final value
      followed by 0) — only counters mounted by in-app navigation count, once, when on screen. Reduced motion → final value at once.
- [ ] **StatusMark** (Micro/StatusMark, done state) → `NextStep tone="done"`: the circle and check draw in (≈450 ms) instead of a static icon.
      Pure SVG + CSS, server component, keeps the accessible label.
- [ ] Close-progress bar on Beranda fills from 0 on arrival (same CountUp rule).
- [ ] `ui-rules` gets a **Motion** section: what moves and why, the limits (≤ 450 ms, once, reduced-motion honoured, never on report tables
      or while typing), the approved components, and the React Bits families that stay out and why.
- [ ] Tests: `tweenMinor` exact at 0/1, monotone, bigint-only, negative values; server render of `CountUp`/`CheckDraw` holds the final value.

**Non-goals:** Backgrounds other than DotGrid; gradient/shiny/glitch/decrypt text; glass, glow, tilt, magnet, cursor effects; 3D; animated
tables or ledger rows; a motion library dependency; any change to numbers, accounting logic or schema.

**Assumptions:** (1) The user waived the approval gate ("don't ask, get it done and merge"), so this cycle builds, ships and merges without
stopping. (2) Porting React Bits source into the product is within its licence (product use, not redistribution of the components).
(3) No gate-reopener: no new dependency, no migration, no AI use, no accounting invariant touched.

## Tasks
- [ ] T1 `lib/motion.ts` (tween + easing) + `components/motion/{count-up,check-draw,dot-grid}.tsx` + licence file — accept: unit tests pass
- [ ] T2 Page settle (`app/(app)/template.tsx`) + auth shell (DotGrid + card settle) — accept: login renders, e2e unaffected
- [ ] T3 CountUp on client overview + Beranda; CheckDraw in `NextStep` done; progress fill — accept: typecheck, e2e investor walk green
- [ ] T4 `ui-rules` Motion section + AGENTS repo map — accept: no stale text

## Implementation
## Verification
## Ship Notes

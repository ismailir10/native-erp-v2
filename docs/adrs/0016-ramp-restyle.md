# 0016 — Ramp-style look with a strong blue

**Status.** Accepted, 2026-10-08 (owner: "examine ramp.com, adopt the styling but use strong blue instead of yellow, update the design tokens including font").
Supersedes the visual part of [ui-rules](../../.agents/skills/ui-rules/SKILL.md) as of PR #119 ("ledger paper": Newsreader titles, ink blue, 2px corners).

**Context.** The "ledger paper" look read as a document, not a product: serif titles, a dark navy accent that barely differed from the ink, and
2px corners. [ramp.com](https://ramp.com/) (measured 2026-10-08) is the reference the owner wants: Lausanne at weight 400 with tight tracking
(64/64 h1), near-black ink `#0c0a08`, warm-grey panels `#f4f2f0`, 6–16px corners, flat buttons in a loud accent (lime `#e4f222`) plus black,
and pale-blue icon tiles.

**Decision.**
1. **Font:** Hanken Grotesk Variable (`@fontsource-variable/hanken-grotesk`, self-hosted) for all text. Lausanne is commercial, so we use the closest free
   grotesque that has tabular numerals (compared with Instrument Sans, Geist and Inter Tight on Indonesian copy and amounts). Inter and Newsreader are removed.
   Display type is the same family, regular weight, tight tracking (`.display`).
2. **Accent:** `#2152E8` (white text 6.1:1; on the canvas 5.5:1), hover `#1A44C4`, tint `#E6ECFD`. It replaces ink blue `#1F3A8A` everywhere, including
   `--chart-1` (the brighter blue now sits inside the dataviz lightness band; the validator passes with the grey "Lainnya" slot as the only, intended, chroma exception).
3. **Neutrals:** canvas `#F4F2F0`, ink `#0C0A08`, hairline `#E4E0DB`, muted text `#5F5B58`, control border `#8F8A85` (3.4:1, kept at WCAG non-text contrast rather than Ramp's lighter `#d2cecb`).
4. **Shape:** `--radius` 8px; cards 12px, auth card 16px, chips full-round; controls 36px. Flat: no shadows or gradients.
5. **Rules kept:** blue = actions only, never a figure; `.drill` dotted underline; status = icon + label; no AI-slop list.

**Consequences.**
- One dependency swap (`hanken-grotesk` in, `inter` and `newsreader` out). The static product deck in `public/deck` keeps its own Inter and is not restyled.
- Any new colour or radius goes through tokens. Components that hard-coded `rounded-sm` for chips were moved to `rounded-full`.
- Dark mode is still not supported.

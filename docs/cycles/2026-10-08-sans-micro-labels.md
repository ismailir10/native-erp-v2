# Micro-labels in the UI sans, not uppercase monospace

## Context
The owner flagged the app's micro-label style (`.eyebrow`: system monospace, 11 px, uppercase, tracked — e.g. a sidebar group label
reading `AKUNTANSI · BELIFI (RETEST 8 OKT)`) as generic AI-looking chrome and asked for an equivalent that does not look like it.
Same role, same place, different voice.

## Spec
Approval: the owner's request, given in-session (same pattern as the two-decks cycle).

- [x] **`.eyebrow` becomes the UI sans** (Inter) at 12 px, medium weight, sentence case, muted colour, almost no tracking. It keeps its job
  (table headers, stat labels, eyebrows) and its place in the hierarchy through size, weight and colour instead of case and spacing.
- [x] **The sidebar group label follows**, since it hard-codes the same mono + uppercase classes.
- [x] **`ui-rules` is updated** so the next page does not bring monospace back.

**Non-goals:** the body font, Newsreader display titles, status pills (already sans), data-driven uppercase (statement totals).
**Assumption:** "equal" means equal role and size, not equal look. Text is shown as written (client and entity names keep their own casing).

## Tasks
- [x] T1 `.eyebrow`, sidebar group label, `ui-rules` — accept: no `font-mono … uppercase` micro-label class remains in `app/` or `components/`; CI green.

## Implementation
- `app/globals.css` `.eyebrow`: `text-xs font-medium tracking-[0.01em] text-muted-foreground`.
- `components/ui/sidebar.tsx` `SidebarGroupLabel`: same classes minus mono/uppercase.
- `.agents/skills/ui-rules/SKILL.md`: micro-label rule and description.

## Verification
- `grep` finds no remaining `font-mono` + `uppercase` pair in `app/` or `components/`; no test depends on the CSS case (the one `toUpperCase` in tests
  is a statement string).
- **Not run locally:** lint, typecheck, unit/DB tests, build, `verify:books`, e2e — the sandbox cannot `npm ci` (`cdn.sheetjs.com` blocked) and this is
  presentation-only CSS. CI runs them. No screenshot of the running app was possible for the same reason.

## Ship Notes

---
name: ui-rules
description: Buku UI standard — Stripe-dashboard look (light canvas, white cards, strong blue), shadcn-first, "Don't Make Me Think" rules and Bahasa copy. Load before touching app/ or components/.
---

# UI rules

## Look (tokens in `app/globals.css` — never hard-code hex in components)
- Canvas `--background #F6F9FC`, white cards, 1px `--border #E3E8EE`, navy text `--foreground #0A2540`.
- **One strong blue**: `--primary #0A5CFF` (5:1 on white — OK for text and fills), tint `bg-primary-subtle`.
- Status tokens `pass / review / fail` (+ `-subtle`) are reserved for control & state — never for chart series.
- Inter (self-hosted via `@fontsource-variable/inter`), `.num` = tabular numerals on every amount.
- Radius 8px, `shadow-xs` on cards, generous whitespace; no gradients except the cash area fill.

## Components
- **shadcn first** (`components/ui/*`, base-nova on `@base-ui/react` — composition uses `render={<Link/>}`, not `asChild`).
  Vendored from annisaa-erp-v3 because `ui.shadcn.com` is blocked in the sandbox; add new ones from npm `shadcn` registry source or copy, then adapt tokens.
- Product building blocks in `components/app/`: `PageHeader`, `NextStep`, `Stat`, `Money`, `StatusPill`, `MethodBadge`, `ScopeBar`, `FsTable`, charts. Reuse before creating.
- Charts: shadcn `chart` + Recharts. Load the `dataviz` skill first; run its palette validator. Single series → no legend;
  ≥2 series → legend + tooltip; if a colour fails 3:1 contrast, show the numbers in a table too. `isAnimationActive={false}`.
- **Checkbox gotcha:** never wrap a base-ui `Checkbox` in `<label>` — the click is forwarded and toggles twice.
  Use `id` + `<label htmlFor>`.
- Don't block keyboard input on `useTransition` pending when a `router.refresh()` follows; use an explicit busy flag.

## "Don't make me think"
1. **Every page says what to do next** — a `NextStep` banner with at most one CTA.
2. One primary button per view; everything else `outline`/`ghost`.
3. State lives in the URL (`?period=2026-08&entity=<id>|combined`) so every view is linkable; pickers via `ScopeBar`.
4. Numbers right-aligned, accounting parentheses for negatives, `–` for zero.
5. **Every report number is clickable down to its source** (FS line → account → ledger → bank row sheet).
6. Status = icon + label + colour, never colour alone (`StatusPill`).
7. Errors say what happened and what to do, in Bahasa (server actions return `{ok:false, error}` — show verbatim).
8. Layout works at 390px: no horizontal page scroll; tables may scroll inside their card.

## Copy (Bahasa)
- Accountant vocabulary, not developer vocabulary: *Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Tutup Buku,
  Jurnal Penyesuaian, Rekening Koran, Mutasi, Saldo Awal, Prive, Gabungan Grup*.
- Status words: *Lolos / Perlu dicek / Gagal*, *Nyambung / Ada celah*, *Buku ditutup*.
- Sentence case; short; no exclamation marks; name the thing (“Tutup buku Agustus 2026”, not “Lanjut”).

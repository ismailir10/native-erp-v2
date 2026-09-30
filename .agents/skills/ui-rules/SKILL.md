---
name: ui-rules
description: Buku UI standard — 9fin look on a light background (navy ink, one strong blue, hairlines, sharp corners, mono micro-labels), shadcn-first, "Don't Make Me Think" rules and Bahasa copy. Load before touching app/ or components/.
---

# UI rules

## Look — 9fin on a light background (tokens in `app/globals.css`; never hard-code hex in components)
- Light everywhere: canvas `--background #F5F7FA`, white cards and a **white sidebar**, 1px hairline `--border #E3E7ED`,
  navy ink `--foreground #0B1B32`, secondary text `--muted-foreground #4B5768`.
- **One strong blue `--primary #1D5BD8`** (5.9:1 on white): links, focus rings, selected states. `--brand` is the same
  blue as a fill with white text: the primary button, the logo, the `NextStep` marker. No green in the chrome.
- Sidebar: active item = blue tint (`sidebar-primary`) with dark-blue text, hover = cool grey; text uses `sidebar-*` tokens.
- Status tokens `pass / review / fail` (+ `-subtle`) are reserved for control & state — never chart series.
- Sharp corners: `--radius` 4px. Cards are hairline-bordered, no shadow. No gradients.
- Type: Inter (self-hosted), `.num` = tabular numerals on every amount. **Micro-labels** (table headers, sidebar group
  labels, stat labels, eyebrows) use `.eyebrow`: system monospace, 11px, uppercase, tracked.

## Components
- **shadcn first** (`components/ui/*`, base-nova on `@base-ui/react` — composition uses `render={<Link/>}`, not `asChild`).
  Vendored from annisaa-erp-v3 because `ui.shadcn.com` is blocked in the sandbox; add new ones from npm `shadcn` registry source or copy, then adapt tokens.
- Product building blocks in `components/app/`: `PageHeader`, `NextStep`, `Stat`, `Money`, `StatusPill`, `MethodBadge`, `ScopeBar`, `FsTable`, charts. Reuse before creating.
  Motion pieces live in `components/motion/` (see §Motion).
- Charts: shadcn `chart` + Recharts. Load the `dataviz` skill first; run its palette validator. Single series → no legend;
  ≥2 series → legend + tooltip; if a colour fails 3:1 contrast, show the numbers in a table too. `isAnimationActive={false}`.
- **Checkbox gotcha:** never wrap a base-ui `Checkbox` in `<label>` — the click is forwarded and toggles twice.
  Use `id` + `<label htmlFor>`.
- Don't block keyboard input on `useTransition` pending when a `router.refresh()` follows; use an explicit busy flag.

## Motion (`components/motion/`, ported from React Bits without a motion dependency)
Motion is information, not decoration: it says *you arrived*, *this changed* or *this is done*. Otherwise nothing moves.
- **Approved pieces:** `.page-settle` (every page via `app/(app)/template.tsx`, the auth card), `CountUp` (stat tiles, counts),
  `ProgressFill`, `CheckDraw` (the done mark in `NextStep`), `DotGrid` (auth pages only). Reuse them; don't add a second way to do the same.
- **Limits:** ≤ 450 ms, plays once, ease-out. Never on report/ledger tables, rows, inputs or anything the user is typing into; never loops.
- `prefers-reduced-motion` → no motion at all (the CSS and `useArrival` handle it; new motion must too).
- Hydrated server HTML never replays (`useArrival`): the value painted first is the value kept. Only client navigation animates.
- Money moves in bigint (`lib/motion.ts` `tweenMinor`) and every frame is a real formatted amount; the last frame is the value exactly.
- No lasting `transform` on page wrappers (fixed children would anchor to it) — animate `translate` with fill-mode `backwards`.
- **Stays out** (breaks the look or the "No AI-slop" list): React Bits backgrounds other than DotGrid (aurora, plasma, silk, beams, particles…),
  gradient/shiny/glitch/decrypt/scramble text, glass, glow/star borders, spotlight/tilt/magnet cards, cursor effects, 3D, click sparks.

## "Don't make me think"
1. **Every page says what to do next** — a `NextStep` banner: one plain sentence (the instruction itself, no
   "Langkah berikutnya:" prefix, no icon except the check on completed states) and at most one CTA.
2. One primary button per view; everything else `outline`/`ghost`.
3. State lives in the URL (`?period=2026-08&entity=<id>|combined`) so every view is linkable; pickers via `ScopeBar`.
4. Numbers right-aligned, accounting parentheses for negatives, `–` for zero.
5. **Every report number is clickable down to its source** (FS line → account → ledger → bank row sheet).
6. Status = icon + label + colour, never colour alone (`StatusPill`).
7. Errors say what happened and what to do, in Bahasa (server actions return `{ok:false, error}` — show verbatim).
8. Layout works at 390px: no horizontal page scroll. Hide secondary table columns on phones
   (`hidden md:table-cell`); report comparison columns hide below `sm` (`FsTable`).
9. Show each fact once. Don't repeat a value in a badge *and* a field (e.g. suggested account lives only in the select).
10. Problems first: sort FAIL → REVIEW → PASS inside lists; summarise blockers as counts, the detail is already on screen.
11. No hidden affordances — nothing that only appears on hover. Rows link via their name + a visible chevron.
12. Empty states say what's true ("Tidak ada transaksi pajak terdeteksi bulan ini"), never a column of dashes.
13. Companies before individuals (PT/CV, then the owner) everywhere entities are listed.
14. **One first-run order, computed once:** Unggah data → Saldo awal → Review → Tutup buku (`lib/setup-progress.ts`). Every page that says
    what to do next reads it — never a hand-rolled if/else chain. Setup pages (client Ringkasan, Impor, Saldo Awal) show `SetupSteps`
    ("Langkah n dari 4"); the client menu lists the steps in that order and never hides them in a collapsed group.

## No AI-slop
- No sparkles/magic-wand icons, no gradients-as-decoration, no glassmorphism, no emoji in UI.
- No hype copy ("makin pintar", "ajaib", "powered by AI"). Label what it is: "Dikode otomatis", "Usulan AI".
- AI is shown as a small `AI` method badge + a reason + a confidence; low confidence (<70%) is called out in review colour.
- Hints must be true in both directions ("Naik/Turun …"), never a hard-coded "Naik".

## Copy (Bahasa)
- Accountant vocabulary, not developer vocabulary: *Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Tutup Buku,
  Jurnal Penyesuaian, Rekening Koran, Mutasi, Saldo Awal, Prive, Gabungan Grup*.
- Status words: *Lolos / Perlu dicek / Gagal*, *Nyambung / Ada celah*, *Buku ditutup*.
- Sentence case; short; no exclamation marks; name the thing (“Tutup buku Agustus 2026”, not “Lanjut”).

# Pengaturan klien: split the long settings page into two sections

## Context
Left open by docs/cycles/2026-10-08-ui-clarity-tokens.md. The client page titled "Aturan klasifikasi" (`/clients/[id]/settings`) holds eight unrelated
things on one 3,000 px page: the AI stat tiles, companies and bank accounts, reporting framework, fiscal year, modules, report format, usage limit, client
rules, remembered choices and "Hapus klien". Its title names only the last third, so an accountant looking for "add a bank account" is told this is the
page about classification rules. The owner asked for it ("get them done"), so this cycle is approved.

## Spec
- [x] The page is titled **Pengaturan klien** and has two sections as linked tabs (`?tab=`, server-rendered so only one section is on screen and each is linkable):
  - **Perusahaan & laporan** (default): companies and bank accounts, reporting framework, fiscal year, modules, report format; "Hapus klien" (admin only) at the bottom.
  - **Klasifikasi & AI**: the four AI stat tiles, usage limit, client rules (+ office rules), remembered choices.
- [x] Each section has its own one-sentence NextStep that says what that section is for.
- [x] The sidebar item and the import form's hint use the new name; an unknown `?tab=` falls back to the default section.
- [x] No behaviour change: same cards, same server actions, same permissions (the delete card is still admin-only).

**Non-goals:** changing any card's content or action; moving Kurs / Riwayat perubahan; a settings redesign beyond the split.
**Gate-reopeners:** none (no dependency, schema or env change).
**Assumptions:** 1. Two sections are enough; "Hapus klien" stays at the bottom of the first (e2e and muscle memory expect it there). 2. The route stays `/settings`.

## Tasks
- [x] T1 `LinkTabs` + split the page into two sections — accept: both sections render, default is Perusahaan, unknown tab falls back, delete card admin-only.
- [x] T2 Rename: sidebar item, import-form hint, page title; update the e2e expectations that name the old heading — accept: `add-entity`, `delete-client`, `new-client-bank-row`, `qa-access` green.
- [x] T3 Verify: lint, typecheck, build, the e2e specs that visit settings, screenshots at 1440 and 390 — accept: no horizontal page scroll, no new `ux:sweep` finding.

## Implementation
- Plan: T1, T2 sequential, inline (one page, a handful of string renames).
- T1: `components/app/link-tabs.tsx` (new, server component: sections as links, `aria-current`), `app/(app)/clients/[id]/settings/page.tsx` — two sections chosen by `?tab=` (`perusahaan` default, `klasifikasi`; anything else falls back), page title "Pengaturan klien", one NextStep per section; "Hapus klien" (admin only) stays at the bottom of the first section. Page height 2978 px → 2032 px (Perusahaan & laporan) and 1264 px (Klasifikasi & AI).
- T2: sidebar item "Aturan klasifikasi" → "Perusahaan & aturan" (the group above it is already "Pengaturan klien"); `import-form.tsx` and `client-form.tsx` hints, README line 46, `e2e/add-entity.spec.ts` and `e2e/qa-access.spec.ts` follow the new name. `StatusPill` is always the UI sans (it inherited the display serif inside a `Stat`). `ui-rules` gains the `LinkTabs` rule.

## Verification
- lint + typecheck clean; `npm run build` ✓ (exit 0).
- e2e (`add-entity`, `delete-client`, `new-client-bank-row`, `qa-access`, `workspace`, `early-input`, `investor-demo`) → 13 passed (1.5 m): the AKUNTAN still sees no "Hapus klien", the ADMIN does.
- Both sections at 390 and 360 px: 0 px page scroll; `?tab=ngawur` shows the default section with its tab marked current.
- Screenshots read at 1440 px for both sections.

## Ship Notes
- No migration, env var or dependency. Presentation and navigation labels only; no number or control changed.
- Old links keep working: `/settings` is the default section.
- Rollback: revert the merge.

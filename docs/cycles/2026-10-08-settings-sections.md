# Pengaturan klien: split the long settings page into two sections

## Context
Left open by docs/cycles/2026-10-08-ui-clarity-tokens.md. The client page titled "Aturan klasifikasi" (`/clients/[id]/settings`) holds eight unrelated
things on one 3,000 px page: the AI stat tiles, companies and bank accounts, reporting framework, fiscal year, modules, report format, usage limit, client
rules, remembered choices and "Hapus klien". Its title names only the last third, so an accountant looking for "add a bank account" is told this is the
page about classification rules. The owner asked for it ("get them done"), so this cycle is approved.

## Spec
- [ ] The page is titled **Pengaturan klien** and has two sections as linked tabs (`?tab=`, server-rendered so only one section is on screen and each is linkable):
  - **Perusahaan & laporan** (default): companies and bank accounts, reporting framework, fiscal year, modules, report format; "Hapus klien" (admin only) at the bottom.
  - **Klasifikasi & AI**: the four AI stat tiles, usage limit, client rules (+ office rules), remembered choices.
- [ ] Each section has its own one-sentence NextStep that says what that section is for.
- [ ] The sidebar item and the import form's hint use the new name; an unknown `?tab=` falls back to the default section.
- [ ] No behaviour change: same cards, same server actions, same permissions (the delete card is still admin-only).

**Non-goals:** changing any card's content or action; moving Kurs / Riwayat perubahan; a settings redesign beyond the split.
**Gate-reopeners:** none (no dependency, schema or env change).
**Assumptions:** 1. Two sections are enough; "Hapus klien" stays at the bottom of the first (e2e and muscle memory expect it there). 2. The route stays `/settings`.

## Tasks
- [ ] T1 `LinkTabs` + split the page into two sections — accept: both sections render, default is Perusahaan, unknown tab falls back, delete card admin-only.
- [ ] T2 Rename: sidebar item, import-form hint, page title; update the e2e expectations that name the old heading — accept: `add-entity`, `delete-client`, `new-client-bank-row`, `qa-access` green.
- [ ] T3 Verify: lint, typecheck, build, the e2e specs that visit settings, screenshots at 1440 and 390 — accept: no horizontal page scroll, no new `ux:sweep` finding.

## Implementation
## Verification
## Ship Notes

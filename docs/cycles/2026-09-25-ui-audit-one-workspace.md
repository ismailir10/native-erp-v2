# UI audit, one workspace, real-data run, promotion

## Context
The user asked for a "Don't Make Me Think" audit of staging: consistent components and a fix for anything ugly. They then want an end-to-end test on real Chickin data with a real GLM call, followed by promotion to main. They also want **one workspace**: no synthetic public demo on production linking out to a separate "ruang kerja privat".

Decisions agreed with the user on 2026-09-25:
- Main is the one real workspace, and staging becomes pre-prod.
- The E2E runs locally first, then on the staging deploy.
- The AI budget is raised for the test.
- Claude merges staging → main once everything is green.

## Spec
- [ ] One workspace:
  - Remove the dead public-demo code and every "ruang kerja privat" / "Demo publik" reference.
  - Record the decision in an ADR.
  - Rewrite the real-data and deploy docs so production is the real workspace and staging is a synthetic pre-prod.
- [ ] Navigation:
  - No duplicate entries or icons.
  - One scope picker, always in the page header.
  - Same brand mark on the login page and the sidebar.
- [ ] Components: shadcn tables, selects, labels, badges, tabs, alerts and cards everywhere. Every amount goes through `Money` in the entity's currency, and every date through `formatDate`.
- [ ] Don't Make Me Think:
  - Every page gets a `NextStep`.
  - One primary button per view.
  - No hover-only affordances.
  - Accountant copy instead of developer jargon.
  - Empty states that say what is true.
- [ ] Before/after screenshots at 1280px and 390px, with no horizontal overflow. `verify:books` ALL PASS: no number moves.
- [ ] Real Chickin data plus a real GLM run, locally and on the staging deploy. Findings are recorded here without client figures.
- [ ] Ship to staging, switch production to the real workspace, and merge staging → main with a merge commit.

**Approval:** The user approved the plan on 2026-09-25, including the env switch and self-merge to main.
**Gate reopeners:** None expected. No schema migration and no new dependency. Production env changes (`DEMO_MODE`, database branch) are part of the approved scope.
**Non-goals:** accounting rule changes, new AI features, new roles, copying staging secrets into production.

## Tasks
- [x] T1 One workspace (code + docs)
- [x] T2 Navigation and scope
- [x] T3 Component consistency
- [x] T4 Don't Make Me Think pass
- [x] T5 Visual pass and end-of-cycle gates
- [ ] T6 Real Chickin + GLM, local
- [ ] T7 Ship to staging and smoke-test the deploy
- [ ] T8 Production switch and promotion

## Audit findings (before)
Screenshots are in [docs/reviews/2026-09-25-ui-audit](../reviews/2026-09-25-ui-audit/README.md). There was no horizontal overflow at 390px on any route.
- **Beranda / Laporan:**
  - Amounts sit far right, away from their labels.
  - A "Dari buku besar" badge is repeated on every company card.
  - The month picker is a native `<input type="month">`, so it renders English ("August 2026").
- **Two scope pickers:** a card with a native month input on top-level pages, and Selects in the header on client pages. Review puts its picker below the title. Dokumen puts the scope above the page title.
- **Sidebar:**
  - "Laporan" and "Laporan Keuangan" are both report entries.
  - "Pengaturan" and "Aturan & AI" are both settings entries.
  - The Inbox and BookOpen icons are each used twice.
  - Setup items and the client list are hidden in raw `<details>`.
- **Client summary:** the control row truncates to "Semua mutasi terklasifi…".
- **Review:** a primary "Terima" button on every card. Income is shown in the `pass` status colour with a +/− sign instead of parentheses.
- **Raw elements:** six raw `<table>`s, raw `<select>`s in Dokumen, raw labels, a hand-made badge, a segmented control and hand-made cards.
- **No `NextStep`:** ledger, trial balance, client reports, import, settings, journals, new client.
- **Leftovers:** `components/app/public-evidence-demo.tsx` (unused) still links to the staging URL as a "ruang kerja privat".

## Implementation
- T1: Deleted the unused public demo component and its two synthetic answer helpers; kept the evidence on/off test as `evidence-config.test.ts`. Dokumen leaves the sidebar when documents are switched off instead of opening a 404. ADR 0008 records production as the one real workspace; README, real-data, evidence and investor docs follow it.
- T2: One scope control everywhere, in the page header: compact client/company and period Selects (Indonesian month names, last 24 months) replace the card with a native month input; Review moves its picker into the header and is titled "Review transaksi". Sidebar: unique icons, collapsibles instead of raw `<details>` (client list open when no client is selected), "Aturan klasifikasi" instead of "Aturan & AI", a Plus on Tambah klien. Login and sidebar share `BrandMark`.
- T3:
  - Six raw tables (FS statement, Gabungan worksheet, revaluation, mapping, journal and opening forms) now use `components/ui/table`. FS account names are visibly underlined links.
  - Dokumen: its raw selects become a shared `SimpleSelect` (shadcn Select), and its status boxes become `Alert`.
  - Labels become `Label`, and the trial-balance view switch becomes `Tabs`.
  - Review shows "Uang masuk/keluar" with the amount in the bank account's currency, instead of a green +/− Rupiah. Recent adjusting journals use `Money` with the entity currency.
  - Dates are Indonesian, and the source page drops the hash and gets outline back buttons.
  - Beranda/Laporan finance cards: amounts sit under their labels, and "Dari buku besar" is stated once in the description instead of as a badge per card.
  - Client summary control rows wrap instead of truncating.
- T4:
  - Every page states its next step: ledger, trial balance, client reports, import, client rules, adjusting journals, new client, and settings when AI is live.
  - One primary button per view: only the active review card's Terima is primary, and Proses mutasi drops to outline once a result offers the next step.
  - Links are visible without hover: account names on ledger, trial balance and FS are underlined, and ledger rows open from an underlined description.
  - The Gabungan note moves from a hover tooltip to inline text.
  - Accountant copy replaces developer terms: no Vercel/env vars, `ADMIN_PASSCODE`, OpenCode Zen, host, merchant, memory, cache, Spot, Checklist or Sheet. "Mulai review" becomes "Review transaksi", and "Perlu review" becomes "Perlu dicek".
  - Empty ledger, trial balance and rate lists say what is missing and how to fill it.
- T5: Captured after screenshots at 1280px and 390px on 19 routes, with no horizontal overflow. Status wording is unified to "Perlu dicek".
  - The e2e run found the setup collapsible toggling shut. The sidebar persists across client navigation, so the section holding the current page is now kept open.
  - The login page is now `force-dynamic`. Its "configured" check ran at build time, so a build without the auth secret prerendered "Akses belum siap".
  - E2E steps were updated for the Periode Select, the Akun sumber tab and the collapsible sections.

## Follow-ups found
- **Jurnal Penyesuaian and Saldo Awal parse amounts as whole Rupiah for every entity** (`parseRupiah` in `adjustmentAction`, `journal-form.tsx`, `opening-form.tsx`). For a non-IDR entity, typing `100` posts 100 minor units (S$1.00). This is an accounting change (currency-aware parsing plus tests), so it is out of scope for this UI cycle. It needs its own cycle before non-IDR adjustments are used on real data.

## Verification
- T1–T5 gates:
  - lint and typecheck clean.
  - Vitest: `Test Files 43 passed (43)`, `Tests 301 passed (301)`.
  - `npm run build` passed.
  - `verify:books`: `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`
- E2E in all three CI modes (`PW_CHROMIUM=/opt/pw-browsers/chromium`):
  - Demo on: `8 passed`.
  - `DEMO_MODE=false`: `8 passed`.
  - Shared-code login: `9 passed`.

## Ship Notes

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
- [ ] T1 One workspace (code + docs)
- [ ] T2 Navigation and scope
- [ ] T3 Component consistency
- [ ] T4 Don't Make Me Think pass
- [ ] T5 Visual pass and end-of-cycle gates
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

## Verification

## Ship Notes

# Workspace self-review

Reviewed against the “Don’t Make Me Think” principle: people should know where they are, what needs attention, and what happens next without learning the implementation.

| Friction found | Change | Evidence |
| --- | --- | --- |
| The question bar lacked an obvious home and context. | Tanya Buku leads Beranda; client/company and period are visible above it and on every answer. | Browser journey changes scope and period, navigates away, and returns to the original answer. |
| Navigation exposed too many accounting destinations at once. | Four primary destinations; accounting detail appears for the selected client, with setup links grouped below it. | Existing import → review → reports → close browser journeys still pass. |
| An amount could be mistaken for an uploaded figure or a consolidated total. | Financial cards say “Dari buku besar”; answers label sources and explain currency and evidence limits. Missing journals stay distinct from zero. | Exact bigint, mixed-currency, missing-data, and source-reference tests. |
| Bulk review could reach outside the selected company/period. | The server validates and limits bulk review to the visible scope and cutoff. | Database regression test leaves another company and future transactions untouched. |
| Keyboard and mobile controls were easy to miss. | Visible labels and heading semantics, skip link before navigation, mobile navigation and logout. | Browser checks first Tab → skip link → content, Escape, and no horizontal overflow at 390px. |
| Different public/private document screens would teach users two products. | The same protected workspace renders with demo mode on or off. | Both configurations exercise the same browser journeys with synthetic data. |

The HTML prototype was also corrected for source inspection returning to the same report/question, retained account selections during review, visible search labels, and empty-state recovery. See the [prototype review guide](../../prototypes/README.md).

## Screenshots

Synthetic test data only. The desktop screenshot includes the visible focus outline after keyboard navigation. The mobile screenshot deliberately shows a previous all-client answer while the current scope is one company, proving that answer context stays explicit.

[Desktop dashboard](desktop.png) · [390px workspace and answer](mobile.png)

## Limits

This is an implementation review and automated walkthrough, not observed user research or a full WCAG audit. Tanya Buku currently supports bounded deterministic questions; unsupported requests are stated explicitly. Answer history is memory-only and disappears on reload or logout. Real email delivery and deployment configuration remain rollout checks.

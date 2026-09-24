# Public Dokumen access

## Context
The user wants the new workspace accessible from https://native-erp-v2.vercel.app and explicitly chose public access. Production is a shared synthetic demo without app authentication; private Drive evidence belongs to the protected real-data deployment.

## Spec
- [ ] Show Dokumen in public navigation and serve an interactive synthetic evidence demonstration at /documents.
- [ ] Run invented reports and company notes through the existing extractor; support source search, context, comparisons, and exact source citations without paid AI or database writes.
- [ ] Clearly label source-reported figures, missing transaction detail, and synthetic examples. Link to the protected workspace for personal uploads and Google Drive.
- [ ] Keep all private evidence routes, server actions, credentials, and records behind the existing protected-deployment gate, including when EVIDENCE_ENABLED is accidentally true on the demo.
- [ ] Verify desktop/mobile UX and public production access, merge green CI, and deploy.
- [ ] Repair the private workspace failure reported during this cycle: invalid Excel dates, loose code-file noise, oversized file-list rendering, buried questions and unclear progress. Reproduce and verify the exact deployed intake in Chrome MCP.

**Non-goals:** exposing Chickin files or Google credentials publicly, public file uploads into a shared firm, new authentication, migrations, dependencies, paid AI calls, accounting changes.
**Assumptions:** Public means synthetic demonstration; the existing real workspace remains protected. This interpretation was stated to the user immediately after their public-access choice.
**Approval:** User requested production access and answered “just make it public” after being offered public synthetic evidence or a protected real workspace.

## Tasks
- [x] T1 Public synthetic workspace, protected boundary regression checks, demo documentation — accept: public navigation/search/comparison/citations work; private writes remain disabled.
- [x] T1b Private intake repair — accept: invalid dates are actionable cell issues, large workspaces remain navigable with visible questions/progress, and code files are ignored.
- [ ] T2 Full verification and delivery — accept: all repo gates and CI green, merged and production /documents accessible.

## Implementation
- Plan: T1–T2 sequential, done inline because the public/private routing boundary and demo UI form one small slice.
- User additionally reported the Chickin intake as broken and explicitly required Chrome MCP verification. Reproduced invalid-date errors and a hundreds-row page burying questions; delegated the independent extractor repair and synthetic regression, while the driver handles workspace rendering, routing, integration and live verification.

- T1: Public synthetic examples use the existing extractor and exact minor-unit calculations. Production navigation exposes /documents while private actions retain their original gate. Source comparison, citations, context and 390px layout exercised in Chrome MCP.
- T1b: Excel invalid dates now retain usable content with cell-coordinate issues; inventory ignores loose code/tooling files. File search, 20-item pages and lazy sheet forms keep large intakes navigable; questions and progress counts appear above the list. Retry processes the selected failed document immediately.

## Verification
- Final lint and typecheck passed. Vitest: 35 files / 261 tests passed in 50.95s; includes public/private boundaries, synthetic source comparisons/citations, invalid Excel dates and ignored loose code files.
- Layer-2 books verification: ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.
- Chrome MCP reproduced the reported staging errors and confirmed pause finishes the active step. Local public comparison returned USD 250 and its citation highlighted the exact 2024 revenue line. Profile/missing-evidence answers and 390px no-overflow layout verified.

## Ship Notes

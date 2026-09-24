# Folder-to-evidence workspace

## Context
Accountants receive mixed folders containing statements, ledgers, reports, company context, and competing versions. Approved plan in this task: one intake workspace prepares evidence and imports, exposes conflicts, and answers sourced questions without posting through chat.

## Spec
- [x] Unified pre-client/client Dokumen workspace, uploads and read-only Google OAuth folder ingestion.
- [x] Versioned snapshots, resumable bounded processing, explicit partial results, refresh on demand.
- [x] Text PDF/XLSX/CSV/Google Docs/Sheets/TXT/Markdown extraction with immutable source locations; unsupported types visible.
- [x] Proposed company facts, entity/period/currency/source roles, duplicate/overlap/conflict review, confirmed context preserved.
- [x] Supported import handoff only after explicit selection/approval; existing accounting controls remain authoritative.
- [x] Ask bar reads uploaded reports before posting and live books with cited deterministic figures and bounded AI planning.
- [x] Atomic shared AI budget, client-scoped caches, synthetic regression coverage, protected pilot rollout.

**Non-goals:** OCR, Drive writes/monitoring, autonomous posting, adjustment-journal drafting, public multi-user auth.
**Assumptions:** Google admin connection; protected pilot only; pause/resume while browser open; source snapshots in Postgres; 10 MiB/file, 100 MiB/intake, 500 discovered files; 1 MiB upload chunks. New schema and evidence-only reported figures explicitly approved. No new runtime dependencies or live paid AI tests planned.
**Approval:** User explicitly requested implementation of the complete plan in this task.

## Tasks
- [x] T1 Data foundation, bounded uploads, leased jobs, foreign entities.
- [x] T2 Google OAuth and read-only Drive adapter.
- [x] T3 Versioned extraction with exact source coordinates.
- [x] T4 Resumable inventory, company context, conflicts and shared AI foundation.
- [x] T5 Unified workspace, onboarding and approved import handoff.
- [x] T6 Ask bar, cited read tools and scoped answer-planning caches.
- [x] T7 Synthetic integration/E2E verification, accounting and private rollout docs.

## Implementation
- Plan: T1 then integration T2–T7; independent extraction, Drive adapter, and AI budget/provider slices delegated per build skill. Driver owns schema, persistence, workspace, integration, review, and commits.

- T1: Data foundation, bounded uploads, leased jobs and foreign entities.

- T2: Google OAuth, encrypted refresh credentials and bounded read-only Drive adapter.

- T3: PDF, workbook and text extraction with immutable coordinates and explicit limits.

- T4: Resumable inventory, proposed facts, bounded conflicts and shared AI budget/cache foundation.

- T5: Unified Dokumen workspace, source review, onboarding and explicit import approval.

- T6: Cited document questions, comparisons and live ledger/control tools with scoped plan caches.

- T7: Synthetic browser journey, accounting invariants and private pilot deployment documentation.

- Final review: bounded PDF page/text streaming and cleanup; retained confirmed historical context with conflicting replacements and exclusion checks; planned source dates respect visible-period precedence.

## Verification

### T1 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  34.83s (tests 80%, import 17%, transform 2%)
```

### T2 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  52.01s (tests 76%, import 18%, transform 5%)
```

### T3 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  46.19s (tests 82%, import 15%, transform 2%)
```

### T4 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  37.08s (tests 79%, import 17%, transform 4%)
```

### T5 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  39.01s (tests 79%, import 18%, transform 2%)
```

### T6 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  33.74s (tests 80%, import 17%, transform 2%)
```

### T7 gate
`npm run lint && npm run typecheck && npm test` passed.
```text
Test Files  33 passed (33)
Tests  252 passed (252)
Duration  34.14s (tests 80%, import 17%, transform 3%)
```

### End-of-cycle verification
- Final lint and TypeScript: passed.
- Final Vitest: **34 files, 257 tests passed** (34.64s). Includes PDF limits/passwords, historic confirmed context, source-date precedence, and all baseline accounting regressions.
- Production build: **passed**, all evidence routes compiled. Local Turbopack could not bind its worker port; used `npm run build -- --webpack`. Generated caching was temporarily disabled after local disk exhaustion; `next.config.ts` was restored exactly. CI retains the normal build command.
- Disposable `buku_test` seed + `npm run verify:books`: `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.`
- Public-demo browser suite: **3 passed** (22.6s); private-pilot test is intentionally flag-gated in that run.
- Separate private-pilot browser suite: **1 passed** (17.2s), with paid AI disabled. Upload, pause/reopen auto-resume, unsupported inputs, foreign-entity proposals, report questions before onboarding, exact citations, mobile overflow and unchanged books verified.
- Desktop/mobile screenshots visually reviewed; synthetic screenshots saved under `docs/demo/evidence/`. No live Google consent or paid AI used.

## Ship Notes
- Additive migrations introduce evidence/OAuth/budget records, active-version pointers, source-selection/import references, foreign legal-entity kind, text-search index and scoped AI caches. No old books are rewritten.
- Configure `EVIDENCE_ENABLED=true`, `DEMO_MODE=false`; Vercel additionally requires protected preview + `EVIDENCE_PRIVATE_DEPLOYMENT=true`. Public production/demo remain disabled.
- Google deployment prerequisites: Drive API enabled, OAuth consent/test users, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, fixed `GOOGLE_REDIRECT_URI`, existing admin passcode and settings-secret encryption. Live Google consent was not exercised; adapters/OAuth were mocked in automated checks.
- No new dependencies and no paid AI calls in verification. Private customer files were not committed or used as fixtures.
- Conservative layout support: ambiguous/multi-column figures stay cited text; AI structure hints remain proposals. Scans/unsupported formats require export; source scale must be full units for posting. Partial work remains visibly incomplete.
- Rollback: disable feature flag; preserve additive tables, source versions and encryption secret. See `docs/evidence-workspace.md` for full setup and public Google-scope requirements.


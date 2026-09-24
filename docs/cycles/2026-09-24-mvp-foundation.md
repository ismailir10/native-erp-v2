# Cycle 0 — MVP foundation (investor demo) + way of working

## Context
Turn a one-time Claude reconciliation engagement (Drive `AI Rightjet/chickin`, `belifi`: bank mutation → GL → TB → FS,
multi-entity with owner, intercompany 1190, clearing 1199, 3-layer verification) into an AI-native SaaS for the Indonesian
market, "Rillet for Indonesia". Outcome: a working MVP for potential investors that demonstrates the core close loop, plus a
repeatable way of working so the next session can build features on a different dev cycle. Greenfield repo.

## Spec
Decisions from the user (session Q&A):
- [x] ICP **accounting firms** (multi-client). Hero flows: **bank import + AI coding**, **GL→TB→FS drill-down**,
      **multi-entity combined view**, **close checklist + controls**.
- [x] AI **hybrid**, provider **OpenCode Zen** (OpenAI-compatible, model via env), **credit-frugal**: tests/demo run offline.
- [x] Stack **Next.js + Neon + Vercel**, **local-first** now (user provisions Neon/Vercel/keys later).
- [x] UI **Bahasa only**, Stripe style, strong blue on light background, shadcn first, "don't make me think".
- [x] **Light tax tags** (PPN split, PPh tags, estimate card). Working name **Buku**. Auth out of scope.
- [x] Demo data **chickin-shaped synthetic** (real data not readable + NDA/UU PDP).
- [x] CLAUDE.md/AGENTS.md + skills adapted from annisaa-erp-v3's workflow.

**Non-goals:** auth/roles, PDF statements, e-Faktur/Coretax, AR/AP, FX, bank APIs, SAK consolidation, deployment.

**Assumptions (accepted in the plan's self-review):** cash-basis books + adjusting journals is an honest framing;
PT + owner "Gabungan" is a management view, labelled as such; AI suggestions never auto-post; bank export formats are
approximations to validate with real files.

## Tasks
- [x] T1 Scaffold: Next 16, Tailwind 4, vendored shadcn, Stripe-blue tokens, app shell
- [x] T2 Prisma schema + CHECK constraints, `postJournal()` invariants, COA template (SAK EP-style), tenancy seam
- [x] T3 Parsers (BCA CSV, Mandiri XLSX, BRI CSV, generic), continuity + dedupe, import pipeline
- [x] T4 Classifier: transfer matcher (1199/1190), rules, memory, OpenAI-compatible LLM w/ cache + budget + mock, review/reclass
- [x] T5 Reports: TB, Laba Rugi, Neraca, combined worksheet w/ elimination, charts series, tax card
- [x] T6 Controls + close (acks, sign-offs, lock)
- [x] T7 Demo generator + seed through the real pipeline + `verify:books` ground truth
- [x] T8 UI pages: Beranda, Ringkasan, Impor, Review, Buku Besar (+source sheet), Neraca Saldo, Laporan, Jurnal Penyesuaian, Tutup Buku, Aturan & AI
- [x] T9 Playwright investor walk; investor script
- [x] T10 CLAUDE.md, AGENTS.md symlink, skills, ADRs, session-start hook, CI, PR template, README

## Implementation
- Plan: driver built inline, sequentially. Greenfield with tightly coupled layers (schema → posting → pipeline → reports → UI), so fan-out would have cost more context than it saved.
- T1–T6 — `prisma/`, `lib/{db,money,format,ledger,import,classify,ai,reports,controls,coa,setup,tenant}` — core domain (commit `95c6b6c`).
- T7 — `lib/demo/*`, `scripts/{seed,verify-books}.ts` — deterministic 3-client × 6-month scenario (commit `61e7454`).
  Found and fixed: unpaired own-name transfers were falling through to AI (now 1199 directly); scenario overdraft guard; signed balances in writers.
- T8–T9 — `app/**`, `components/app/*`, `e2e/*` (commit `a43c64e`). Found and fixed via e2e/screenshots: base-ui Checkbox
  inside `<label>` double-toggles; review Enter blocked by `useTransition` pending during refresh; adjusting entries
  defaulted to the owner instead of the PT; Next 16 `next dev` overwrote AGENTS.md/CLAUDE.md (`agentRules: false`).
- T10 — `CLAUDE.md`, `.claude/{settings.json,skills/*}`, `docs/*`, `scripts/{session-start.sh,ai-smoke.ts}`, `.github/*`, `README.md`.

- Review pass (post-ship, browser walk + code read):
  - Code/security: server-action body limit raised to 6 MB (default 1 MB broke the advertised 5 MB upload);
    sample import validates the bank account belongs to the client; sign-offs/notes rejected on locked periods;
    default period derived from data (`lib/periods.ts`) instead of the demo module; unknown client → 404; dead code removed.
  - UI ("don't make me think", no AI slop): banner reduced to one instruction + one button (no lightbulb/label);
    Sparkles icon removed; review card shows each fact once; problems sorted first and blockers summarised on
    Tutup Buku; no hover-only links; phone layouts hide secondary columns; tax empty state; truthful Naik/Turun
    hints; plain chart titles; proper-case entity names; companies before owners; drill-down sheet full width;
    firm rules folded under client rules. Lessons encoded in `.claude/skills/ui-rules`.

## Verification
- Layer 1 `npx vitest run`: `Test Files 5 passed (5) · Tests 28 passed (28)` — incl. full pipeline against Postgres and the seeded demo vs ground truth + live upload (0 AI calls).
- Layer 2 `npm run verify:books`: `ALL PASS — 997 pemeriksaan saldo cocok dengan ground truth.`
- Layer 3 `npm run build` ✓ (12 routes) and `npx playwright test` against `next start`: `1 passed (13.2s)` — upload → review (recode AI's wrong asset) → P&L → ledger → source row → worksheet eliminated → depreciation JE → 15/15 controls Lolos → period locked.
- `npm run lint` clean · `tsc --noEmit` clean.
- Manual: screenshots reviewed at 1440px (all pages) and 390px (overview, review) — no horizontal scroll.
- Palette: dataviz validator on `#0A5CFF,#14B8A6` → ALL CHECKS PASS (teal contrast WARN → values table under the chart).
- After review pass: lint ✓ · typecheck ✓ · `Tests 28 passed (28)` · build ✓ · `ALL PASS — 997` · Playwright `1 passed (13.2s)` ·
  Chromium walk of all 15 demo steps with console capture: `ERRORS: none`, controls `Lolos=16 Perlu dicek=0 Gagal=0`.
- AI provider not exercised live (sandbox blocks `opencode.ai`); covered by fake-fetch unit test. Run `npm run ai:smoke` locally.

## Ship Notes
- Branch `claude/vibrant-maxwell-23iy5o`; repo had no `main` — PR base needs a `main` branch (ask the owner).
- Env: `DATABASE_URL`, `DEMO_MODE=true`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, optional `AI_MAX_CALLS_PER_IMPORT`, `AI_MONTHLY_TOKEN_BUDGET`.
- Deploy (later, user): Neon via Vercel Marketplace → `npx prisma migrate deploy` → `npm run demo:reset` once → Vercel build `prisma generate && next build`.
- Rollback: stateless app; demo DB is disposable (`demo:reset`).

### Next cycles (recommended order)
1. PDF rekening koran extraction (LLM/vision, cached, same pipeline) — biggest adoption blocker.
2. Auth + firm/user roles (reviewer vs partner sign-off) on the `getCurrentFirm()` seam.
3. Deploy to Vercel + Neon; real-file validation of BCA/Mandiri/BRI formats with a pilot firm.
4. Client onboarding (COA mapping, opening balances import) and export (XLSX/PDF laporan).
5. Tax: PPN/PPh worksheets → Coretax-ready export.

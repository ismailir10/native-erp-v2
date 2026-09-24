# Buku

**AI-native month-end close for Indonesian accounting firms.** Upload a client's *rekening koran*; Buku codes every line,
posts a double-entry ledger, reconciles, and produces Laba Rugi, Neraca and a PT + owner combined view — where **every
number traces back to the bank row it came from**. The accountant reviews what the AI proposes and closes the month.

> Status: investor MVP (cycle 0). Auth, PDF statements, tax filing and deployment are next — see
> [docs/cycles/2026-09-24-mvp-foundation.md](docs/cycles/2026-09-24-mvp-foundation.md).

## What it does
| Area | |
|---|---|
| **Import** | KlikBCA CSV, Mandiri XLSX, BRI CSV, generic column detection · running-balance continuity check · dedupe on re-upload |
| **Classify** | transfer matcher (own accounts → 1199, group entities → 1190) → rules → learned memory → LLM (cached, capped) → review |
| **Ledger** | double entry, BigInt Rupiah, immutable entries, reclass-by-difference, period locks, PPN 11% split |
| **Reports** | Neraca Saldo, Laba Rugi (month + YTD), Neraca (comparative), Kertas Kerja Gabungan with intercompany elimination, drill-down to source |
| **Close** | 15 controls (TB, A=L+E, bank recon per account, continuity, clearing, suspense, intercompany), notes, sign-offs, lock |
| **Demo** | 3 synthetic clients × 6 months seeded through the real pipeline; [5-minute investor script](docs/demo/investor-demo.md) |

## Quick start
```bash
cp .env.example .env
docker compose up -d            # Postgres 16 (or use your own; see DATABASE_URL)
npm ci
npx prisma migrate deploy
npm run demo:reset              # seed "KJA Demo & Rekan" (≈5 s, no AI credit used)
npm run dev                     # http://localhost:3000
```
Claude Code sessions run `scripts/session-start.sh` automatically (Postgres, deps, migrate, seed).

## Commands
| | |
|---|---|
| `npm test` | Vitest: unit + Postgres + demo-vs-ground-truth (uses `buku_test`) |
| `npm run verify:books` | Recompute ~1,000 balances from generator truth and compare with the app → `ALL PASS` |
| `npm run build && npm run test:e2e` | Playwright investor walk against `next start` |
| `npm run ai:smoke` | One real, capped LLM call to check `AI_API_KEY` / `AI_MODEL` |
| `npm run lint` · `npm run typecheck` | |

## Stack
Next.js 16 (App Router, server actions) · TypeScript · Tailwind v4 · shadcn (base-nova) · Recharts · Prisma 7 + Postgres
(Neon in production) · Vitest · Playwright. LLM via any OpenAI-compatible endpoint — OpenCode Zen by default.

## Environment
| Var | |
|---|---|
| `DATABASE_URL` | Postgres URL (Neon pooled URL in production) |
| `DEMO_MODE` | `true` enables the demo firm + *Reset data demo* |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | LLM gateway. Empty key = rules + memory only (fully functional) |
| `AI_MAX_CALLS_PER_IMPORT` / `AI_MONTHLY_TOKEN_BUDGET` | Credit guards (defaults 3 / 200 000) |

## For contributors (humans and agents)
Read [CLAUDE.md](CLAUDE.md) (= `AGENTS.md`): the spec → build → ship loop, gates, and which skill governs which folder.
Decisions live in [docs/adrs](docs/adrs/README.md). Demo data is synthetic — never commit real client statements.

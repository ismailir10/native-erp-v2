# Buku — Operating Manual

> How to work on this repo. [README.md](./README.md) is the *what*; this file is the *how*.
> `AGENTS.md` is a **symlink to this file** (Codex, opencode, Cursor read it). Edit only `CLAUDE.md`.
> Rule for editing this file: never hand-write a fact the code owns — link to it instead.

**Product in one line:** AI-native month-end close for Indonesian accounting firms (Rillet-style) —
*rekening koran in → laporan keuangan out, every number traceable to its bank row.*
Language: UI and domain copy in **Bahasa Indonesia**; code, comments, commits in **English**.

---

## 1. First five minutes of any session

```bash
bash scripts/session-start.sh     # starts Postgres, installs deps, migrates, seeds if empty (hook runs it)
npm run dev                       # http://localhost:3000 — demo firm "KJA Demo & Rekan"
npm test                          # Vitest (unit + DB + demo ground-truth)
npm run verify:books              # layer-2: app balances vs generator truth → must print ALL PASS
```

Then read, in this order: the latest `docs/cycles/*.md` (what happened last), `docs/adrs/` (why things
are the way they are), and the skill for the area you're about to touch (§4).

Next.js here is **16.x** — APIs differ from older training data. When unsure, read
`node_modules/next/dist/docs/` before writing code (`agentRules: false` in `next.config.ts` stops
`next dev` from overwriting this file with its own stub).

## 2. The loop — one cycle = spec → build → ship

| Step | Skill | Output |
|---|---|---|
| `/spec` | [`.claude/skills/spec`](.claude/skills/spec/SKILL.md) | `docs/cycles/YYYY-MM-DD-<slug>.md` with Context / Spec / Tasks. **Stop for approval.** |
| `/build` | [`.claude/skills/build`](.claude/skills/build/SKILL.md) | One commit per task, gates between tasks, cycle doc updated as you go |
| `/ship` | [`.claude/skills/ship`](.claude/skills/ship/SKILL.md) | Push branch, draft PR to `staging`, CI green, Ship Notes filled |

**You drive the loop, not the user.** The user says what they want; you classify it:

| Request | Action |
|---|---|
| Changes code in `app/ lib/ components/ prisma/ scripts/ e2e/` or CI | Run a cycle (spec → approval → build → ship) |
| Changes only docs/skills (`CLAUDE.md`, `.claude/**`, `docs/**`) | Small PR; a cycle doc only if it's more than a fix |
| Question, code read, DB inspection | Answer inline — no cycle |

The Spec approval is the **only** human gate. Re-open it if the work changes shape underneath you
(new dependency, schema migration, anything the Spec called a non-goal).

The loop lives only in the three skills. **A different dev cycle for the next phase = edit those
skills**, not this file.

## 3. Gates

| Gate | Command | When |
|---|---|---|
| Between tasks | `npm run lint && npm run typecheck && npm test` | Before every commit |
| End of cycle | the above **+** `npm run build && npm run verify:books && npm run test:e2e` | After the last task |
| CI | `.github/workflows/ci.yml` (same as end-of-cycle, on Postgres service) | Every PR |

`npm run test:e2e` builds nothing itself — run `npm run build` first (it starts `next start`).
In the Claude cloud sandbox set `PW_CHROMIUM=/opt/pw-browsers/chromium` (never `playwright install`).

## 4. Where the rules live (load on demand)

| Touching | Load first |
|---|---|
| `lib/ledger/** lib/import/** lib/ledger-import/** lib/fx/** lib/classify/** lib/ai/** lib/reports/** lib/controls/** prisma/**` | [`accounting-rules`](.claude/skills/accounting-rules/SKILL.md) — **non-negotiable invariants** |
| `app/** components/**` | [`ui-rules`](.claude/skills/ui-rules/SKILL.md) — Stripe look, shadcn-first, "don't make me think" |
| `lib/demo/** scripts/seed.ts e2e/**` | [`demo-data`](.claude/skills/demo-data/SKILL.md) |
| Anything that changes a number on a report | [`verify-books`](.claude/skills/verify-books/SKILL.md) |

Top five invariants (full list in `accounting-rules`):
1. **GL is the single source of truth.** No stored balances; TB/FS are derived from `JournalLine`.
2. **`postJournal()` is the only writer** of journals. Balanced, open period, client COA — plus DB CHECKs.
3. **Money is `bigint` minor units of the entity's currency** (IDR = whole Rupiah). Never `Number`/`parseFloat` an amount. Use `lib/money.ts`.
4. **AI never auto-posts.** LLM suggestions go to review; only deterministic methods post directly.
5. **Every entry keeps its source** (`bankTransactionId`, or `ledgerImportId` + `sheet!row`) so any report number drills to its source row.

## 5. Repo map

```
app/(app)/                 pages (Beranda + /clients/[id]/{import,review,ledger,trial-balance,reports,journals/new,close,settings})
app/actions.ts             server actions — the only UI write path
components/ui/             shadcn (base-nova on @base-ui/react), vendored — edit sparingly
components/app/            product components (Money, StatusPill, NextStep, charts, forms)
lib/ledger/                postJournal, bank posting + reclass
lib/import/                parsers (BCA/Mandiri/BRI/SMBC/generic, combined PDFs), normalize (merchant key, continuity), pipeline
lib/ledger-import/         ledger/Neraca files: read → check → map (source accounts) → post
lib/fx/                    currency registry + exact rate math, Kurs table, revaluation
lib/classify/  lib/ai/     transfer matcher, rules, memory; OpenAI-compatible LLM provider + cache + budget
lib/reports/  lib/controls/ TB, Laba Rugi, Neraca, combined worksheet, tax card; close controls + lock
lib/demo/                  scenario generator, bank-format writers, seed, ground-truth verifier
prisma/                    schema + migrations (CHECK constraints live in the init migration)
tests/{unit,db}/           Vitest (DB tests use buku_test)       e2e/  Playwright investor walk
docs/{cycles,adrs,demo}/   history, decisions, demo script
```

## 6. Environment

- Postgres 16 locally (`docker compose up -d` or the sandbox's preinstalled server); Neon in production.
- `.env` from `.env.example`. `DEMO_MODE=true` enables the seeded firm + Reset button.
- AI: `AI_BASE_URL` (env-only, default OpenCode Zen); key + model from **Pengaturan** (encrypted, `SETTINGS_SECRET`, guarded by
  `ADMIN_PASSCODE`), else `AI_API_KEY` / `AI_MODEL`. No key = rules-only mode, fully working.
- Real client files: only locally or on the protected `staging` preview. Read [docs/real-data.md](docs/real-data.md) first.
  **Credit is limited** — tests and seed never call a real model (MockProvider + cache). `npm run ai:smoke` makes one real call.
- Auth is **out of scope** in the MVP: `lib/tenant.ts#getCurrentFirm()` is the seam. Every query is already firm-scoped.

## 7. Deliberately not copied from annisaa-erp-v3 (and why)

Session-role files, worktree scripts, git-hook suite, doc-count audits.
Greenfield + one developer + CI as the enforcement boundary doesn't need them yet. Add one only
when a real incident shows the need, and record it as an ADR.

## 8. Commits & PRs

- Conventional subjects: `feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`. One task = one commit.
- Body references the cycle doc: `Cycle: docs/cycles/<file>.md`.
- Never commit `.env`, real client statements, or anything under `data/private/` (gitignored). Demo data is synthetic only.
- PRs are drafts to `staging`, body follows `.github/pull_request_template.md`.
- Branch lifecycle and production promotion: follow [README → Branch workflow](README.md#branch-workflow) and the ship skill. Start new work from staging.

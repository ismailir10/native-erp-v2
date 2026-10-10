# Verify local — Buku extensions

Extends the shared [`verify-local`](../../.agents/skills/verify-local/SKILL.md) skill; each section adds to the step of
the same name. Commands and paths: [AGENTS.md § Repo profile](../../AGENTS.md#3-repo-profile).

Everything here runs against local, synthetic data. Never point the app, a seed or e2e at production
([ADR 0015](../adrs/0015-production-only.md)), and never use real client files for verification
([docs/real-data.md](../real-data.md)).

## Run the app

1. `bash scripts/session-start.sh`: Postgres, deps, migrations, demo seed if empty.
2. `npm run auth:local`: the local Supabase Auth stack (Docker), the same one CI's e2e boots; it writes its URL and
   keys into `.env`. No Docker → stop and ask (missing infrastructure), don't skip the walk.
3. `.env` needs `DEMO_MODE=true` and a `DEMO_ADMIN_PASSWORD` (≥ 8 chars). Leave `AI_API_KEY` empty: rules-only mode is
   fully working, and verification never spends AI credit.
4. `npm run demo:reset` for a known state: it wipes the local database, re-seeds "KJA Demo & Rekan" through the real
   import pipeline and recreates the demo admin.
5. Start it:
   - while iterating: `npm run dev` → http://localhost:3000;
   - final round (production build): `npm run build && npm run start -- -p 3200` → http://localhost:3200, the port
     `playwright.config.ts` uses, so `npm run test:e2e` reuses this server. `NEXT_PUBLIC_SUPABASE_*` are inlined at
     build time: run step 2 before building.
6. Health: `/login` shows the email + password form, not "Akses belum siap".
7. Sign in at `/login` with `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` from `.env` (an ADMIN of the demo firm). For an
   AKUNTAN or a second-firm check, the e2e setup creates local members and writes their credentials to
   `.playwright/credentials-*.json` (gitignored).
8. Stop: Ctrl-C the server; `npx supabase@2.118.0 stop` stops the auth stack.

In a cloud sandbox with a preinstalled browser set `PW_CHROMIUM=/opt/pw-browsers/chromium` (never `playwright install`);
start `dockerd` before `npm run auth:local`.

## Walk

- Pick the demo client whose state exercises the flow
  ([demo-data § The planted story](../../.agents/skills/demo-data/SKILL.md#the-planted-story-august-2026)): Grup Ayam
  Nusantara has the open August with planted REVIEWs and a held-back statement, CV Sinar Retail has lines to review,
  PT Jasa Kreatif Digital is fully closed.
- State lives in the URL (`?period=…&entity=…`); note the URLs you walked in the evidence.
- A change that moves a report number: open the report and click the number down to its source (FS line → account →
  ledger → bank or sheet row), and check `/clients/<id>/close`: controls PASS except the planted REVIEWs.
- A change to the investor walk: walk [docs/demo/investor-demo.md](../demo/investor-demo.md) end to end.
- A change across many pages: `npm run ux:sweep` screenshots every page at desktop and phone width.

## Critique

Blockers in this product, besides the shared list:

- **A wrong number** on any report, page or export; `verify:books` not ALL PASS; a balance-sheet difference that is not
  exactly 0; a control FAIL that is not planted ([verify-books](../../.agents/skills/verify-books/SKILL.md)).
- **A report number that does not drill to its source row**
  ([ui-rules § "Don't make me think"](../../.agents/skills/ui-rules/SKILL.md#dont-make-me-think) #5).
- **A broken accounting invariant**, even with green tests
  ([accounting-rules](../../.agents/skills/accounting-rules/SKILL.md)): an amount through `Number`, AI posting
  directly, a stored balance, an entry without its source.
- **Another firm's data** visible or writable
  ([accounting-rules § Tenancy](../../.agents/skills/accounting-rules/SKILL.md#tenancy)).
- **A page that does not say what to do next**, a second primary button, colour-only status, horizontal scroll at
  390px, or English / developer words in UI copy
  ([ui-rules § "Don't make me think"](../../.agents/skills/ui-rules/SKILL.md#dont-make-me-think),
  [§ Copy](../../.agents/skills/ui-rules/SKILL.md#copy-bahasa)).
- **A real model call** or real client data used during verification.

Polish: anything else in [ui-rules](../../.agents/skills/ui-rules/SKILL.md) (look, motion, the
[No AI-slop](../../.agents/skills/ui-rules/SKILL.md#no-ai-slop) list).

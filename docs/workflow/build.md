# Build — Buku extensions

Extends the shared [`build`](../../.agents/skills/build/SKILL.md) skill; each section adds to the step of the same name.
Commands and paths: [AGENTS.md § Repo profile](../../AGENTS.md#3-repo-profile).

## Preflight

- Postgres up and the DB migrated: `bash scripts/session-start.sh`.
- Next.js here is 16.x. Before writing against an API you are unsure of, read `node_modules/next/dist/docs/`.

## Per task

- **Test seams.** Domain logic → Vitest in `tests/unit` (pure) or `tests/db` (Postgres; `resetDb()` + `makeGroup()` from
  `tests/helpers.ts`). UI → drive the page (Playwright script or an e2e step) and look at the screenshot.
- **Anything that can move a number on a report** (parsers, classifier, posting, reports, controls, scenario) →
  `npm run demo:reset && npm run verify:books` must print ALL PASS before the commit
  ([verify-books](../../.agents/skills/verify-books/SKILL.md)).
- **Standards review** checks, besides the shared baseline: the
  [accounting-rules](../../.agents/skills/accounting-rules/SKILL.md) invariants, `bigint` money (never
  `Number`/`parseFloat` an amount), tenant scoping through `getClientForFirm()` before any write, Bahasa UI copy
  ([ui-rules § Copy](../../.agents/skills/ui-rules/SKILL.md#copy-bahasa)).

## After the last task

- Demo walk changed → update `docs/demo/investor-demo.md` and `e2e/investor-demo.spec.ts` together
  ([demo-data § Changing it](../../.agents/skills/demo-data/SKILL.md#changing-it)).

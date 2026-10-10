# Spec — Buku extensions

Extends the shared [`spec`](../../.agents/skills/spec/SKILL.md) skill; each section adds to the step of the same name.
Commands and paths: [AGENTS.md § Repo profile](../../AGENTS.md#3-repo-profile).

## Preflight

1. `bash scripts/session-start.sh` has run (Postgres up, deps, migrated, demo seeded if empty). A harness with a
   session hook runs it on start.
2. "Unfinished record" = the latest `docs/cycles/*.md` whose Tasks have unchecked boxes and whose Ship Notes are empty.
3. While gathering facts, read the prior cycle docs that touched the same area, and look for helpers to reuse before
   proposing new ones: `lib/money.ts`, `postJournal`, `postBankTransaction`, `runControls`, `loadClientPage`,
   `NextStep`, `Money`. Name who feels it: the accountant, the client or bank reading the report, or the investor demo.

## Rules

- **One file:** `docs/cycles/$(date +%Y-%m-%d)-<slug>.md`, starting with `# <Cycle title>`, then the shared record
  sections, then empty `## Implementation`, `## Verification` and `## Ship Notes`.
- **Gate re-openers** also list, when they apply: real AI calls (credit is limited,
  [accounting-rules § AI](../../.agents/skills/accounting-rules/SKILL.md#ai-credit-is-limited--treat-every-call-as-money))
  and any change to an accounting invariant ([accounting-rules](../../.agents/skills/accounting-rules/SKILL.md)).
- **Deck claims:** for a big feature (definition in [ship.md § Deck review](ship.md#deck-review)), name the deck claims
  it will touch under Acceptance criteria, so the review is planned. The review itself runs in `ship` after the PR is
  open; it is not a task.

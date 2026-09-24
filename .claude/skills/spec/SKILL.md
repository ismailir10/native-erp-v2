---
name: spec
description: Start a development cycle for Buku. Writes ONE cycle doc (docs/cycles/YYYY-MM-DD-<slug>.md) with Context, Spec and Tasks, surfaces assumptions, then STOPS for the user's approval. Use before any change to app/, lib/, components/, prisma/, scripts/, e2e/ or CI.
---

# /spec — define and plan, then stop

Output: exactly one file, `docs/cycles/$(date +%Y-%m-%d)-<slug>.md`. No PLAN.md / NOTES.md / sibling docs.

## Preflight
1. `git status` clean? If not, ask whether to commit, stash or abort. Never inherit someone else's dirty tree.
2. Latest `docs/cycles/*.md`: if its Tasks have unchecked boxes and Ship Notes are empty, ask: continue it or start new?
3. `bash scripts/session-start.sh` has run (Postgres up, DB migrated, demo seeded).

## Steps
1. **Understand.** If the request is vague, ask 1–3 sharp questions first (AskUserQuestion). Don't guess at scope.
2. **Explore.** Read the code you'll touch and the skills that govern it (CLAUDE.md §4). Look for existing
   helpers to reuse (`lib/money.ts`, `postJournal`, `postBankTransaction`, `runControls`, `loadClientPage`, `NextStep`, `Money`…).
   Read prior cycle docs that touched the same area.
3. **Write the cycle doc** from the template below.
   - **Context:** the problem, who feels it (accountant? investor demo?), the intended outcome.
   - **Spec:** acceptance criteria as checkboxes · **Non-goals** · **Assumptions** (every one you'd otherwise resolve silently).
   - **Tasks:** ordered, atomic, each independently committable with a one-line acceptance check.
     Mark dependencies. Note `reuse X from lib/...` where applicable.
   - Leave Implementation / Verification / Ship Notes empty.
4. **Flag gate-reopeners explicitly** in the Spec: schema migration, new dependency, AI credit use, change to an accounting invariant.
5. **Present and STOP.** Show Context + Spec + Tasks and end with:
   > **Assumptions:** 1… 2… → Correct me now. On your go-ahead I build and ship without asking again.

   End the turn. Do not start `/build`.

## Template
```markdown
# <Cycle title>

## Context
## Spec
- [ ] …
**Non-goals:** …
**Assumptions:** …
## Tasks
- [ ] T1 <title> — accept: <check>
## Implementation
## Verification
## Ship Notes
```

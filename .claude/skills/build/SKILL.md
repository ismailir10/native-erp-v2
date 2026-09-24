---
name: build
description: Execute the approved tasks of the current Buku cycle doc one at a time — implement, test, gate, self-review, update the cycle doc, commit (one commit per task). Use after /spec was approved.
---

# /build — per-task loop

## Preflight
- The newest `docs/cycles/*.md` has an approved Spec and unchecked Tasks. If not → `/spec`.
- Working tree clean. Postgres up (`bash scripts/session-start.sh`).
- Record the plan as the first Implementation bullet:
  `- Plan: tasks [..] sequential; [..] delegated to subagents (why) | done inline (why).`
  Delegate only independent, fully-specified slices (e.g. one parser, one page); the driver reviews the diff.

## For each unchecked task
1. **Load context** — only the files this task needs + the governing skill(s) (CLAUDE.md §4). Re-check per task.
2. **Implement** one vertical slice. No drive-by refactors.
3. **Test it.**
   - Domain logic → Vitest in `tests/unit` (pure) or `tests/db` (Postgres, uses `resetDb()` + `makeGroup()` from `tests/helpers.ts`).
   - UI → drive the page (Playwright script or e2e step). Look at a screenshot; the validator for layout is your eyes.
   - Anything that changes a report number → `npm run verify:books` (see `verify-books` skill).
4. **Gate:** `npm run lint && npm run typecheck && npm test`. Red → find the root cause, fix, re-run. Never skip a test.
5. **Self-review the diff** adversarially (or `/code-review` if available): invariants in `accounting-rules`,
   `bigint` money, tenant scoping via `getClientForFirm`, Bahasa copy, no dead code. Fix before committing.
6. **Update the cycle doc:** tick the task; add `- T<n>: <files> — <summary>` to Implementation and the real gate
   output tail to Verification. Never write a result you didn't just see.
7. **Commit** (one per task):
   ```
   <type>(<scope>): <task title>

   <why, briefly>

   Cycle: docs/cycles/<file>.md
   ```

## After the last task
1. End-of-cycle gate: `npm run lint && npm run typecheck && npm test && npm run build && npm run verify:books && npm run test:e2e`
   (cloud sandbox: `PW_CHROMIUM=/opt/pw-browsers/chromium`). Paste the real tails into Verification.
2. If the demo flow changed → update `docs/demo/investor-demo.md` and `e2e/investor-demo.spec.ts` together.
3. Fill **Ship Notes**: migrations, env vars, manual steps, rollback. Commit. Hand off to `/ship`.

## Rules
- If the Spec turns out wrong, stop and say so — don't silently re-scope.
- New dependency, schema migration or real AI calls not in the Spec → re-open the gate.

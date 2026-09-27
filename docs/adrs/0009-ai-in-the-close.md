# 0009 — AI in the close: it explains and proposes, the accountant decides

**Context.** A hard test on real client files (27 Sep 2026) showed that Buku parses and posts faithfully (every Chickin account ×
month balance ties to its file) but that the close controls only prove arithmetic. A real bank month closed green while a loan
drawdown sat in revenue and total assets were negative. The direction is Rillet-style: the GL is the system of record and AI
watches it (anomalies, explanations, proposed entries). [0003](0003-hybrid-ai.md) keeps AI away from posting; [0007](0007-evidence-workspace.md)
bounds and budgets evidence calls. Neither covers AI reading the books themselves.

**Decision.**
1. **Deterministic checks first.** Sanity controls (negative asset total, balances against their nature, financing text in the
   P&L, months without data, accepted guesses) are plain code in `lib/controls`. AI never decides whether a control passes.
2. **AI explains and proposes, never acts.** An AI close review returns, per flagged control, an explanation and a proposed action.
   It cannot post, acknowledge, tick a sign-off or lock. Proposed entries (later cycles) are drafts the accountant accepts; posting
   still goes through `postJournal()` via the existing writers.
3. **Cited or dropped.** The review receives an explicit list of control keys and row ids; every returned item must cite only those.
   Anything else is discarded before it reaches the screen.
4. **Bounded payload.** Unlike classification and account mapping (names only), a close review may send **amounts and short bank
   descriptions**, but only of the rows behind flagged controls: at most 40 rows, descriptions cut to 80 characters, no files,
   no evidence passages.
5. **Same money discipline.** Every call reserves through `lib/ai/budget.ts`, has a per-period scope limit, is logged in `AiUsage`,
   and is cached by a hash of its input, model and prompt version, so reopening a page is free. No retries. Tests use `MockProvider`.

**Consequences.** Buku can refuse to call wrong-looking books "ready" without trusting a model, and AI adds value where the
accountant is stuck (why is this flagged, what should I do). Bank descriptions of flagged rows leave the firm's database to the
configured provider; firms that don't want that leave the AI key unset and keep the deterministic controls. Later cycles (1999
fixes, adjustment proposals, questions over the GL) extend this ADR instead of inventing new rules.

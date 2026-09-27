# Close copilot — "Jelaskan" per control, with a draft fix the accountant posts

## Context
The AI close review (ADR 0009) explains *all* flagged controls in one card, as prose. The accountant then still has to turn
"reclassify the Rp 100 jt loan drawdown from 4100 to 2210" into a journal by hand, and to type the note that acknowledges a
REVIEW control. Two gaps: the explanation isn't next to the control it is about, and a proposed fix isn't something you can
post. ADR 0009 decision 2 already allows it: *proposed entries are drafts the accountant accepts; posting still goes through
`postJournal()`*.

Outcome: every FAIL/REVIEW row on Tutup Buku has **Jelaskan**. One AI call for that control returns a diagnosis citing its rows,
and either a **draft adjusting / reclass journal** (stored as a proposal, posted only by the accountant's click, accounts editable)
or a **draft note** (fills the acknowledgement dialog, saved only by the accountant). This is also where reclass proposals live
(the "reclass" part of C4).

Approved in advance by the owner's request ("make sure these are done … finished until it merged to main").

## Spec
Proposals (`lib/adjust/proposals.ts`, new)
- [x] **`ProposedEntry`**: firm, client, entity, period (year/month), source (`AI_CONTROL` now; `SUSPENSE` next cycle), control
      key, dedupe `key` (unique), memo, lines (JSON: account code, debit, credit as minor-unit strings), reason, cited ids, status
      `PROPOSED | POSTED | DISMISSED`, posted `entryId` (unique FK to `JournalEntry`), decided by/at.
- [x] **Post** (click): status must be PROPOSED; the accountant may change each line's **account** (never the amounts); accounts
      must be in the client chart and not bank accounts; balanced, ≥ 2 lines; `postJournal()` kind `ADJUSTMENT`; proposal →
      POSTED with `entryId` in the same transaction (a second click fails cleanly). Locked period refused as every write.
- [x] **Dismiss** (click): PROPOSED → DISMISSED. Nothing else changes a proposal.

Jelaskan (`lib/controls/explain.ts`, reuses `gather()` of the close review for the one control)
- [x] Input: that control's rows only (same ADR 0009 caps: ≤ 10 rows, 80-char texts) + the client chart (codes + names).
- [x] Output, validated before anything is stored: explanation (≤ 400), suggestion (≤ 300), refs ⊆ the control's row ids,
      optional **note** (≤ 300, for REVIEW controls), optional **entry** `{memo, lines:[{accountCode, side, amount}]}`:
      entity-scoped controls only; every account in the chart, never a bank account; balanced; **every line amount equals the
      amount of a cited row** (the AI can't invent numbers); ≥ 2 lines. An invalid entry is dropped, the explanation kept.
- [x] Money discipline (rule 18/20a): `runBudgetedAi` with the close scope limit, cached by input hash + model + prompt version
      (re-asking is free), `AiUsage` logged, no retries. The draft entry is stored once per cache key (`key` unique).
- [x] Prompt names the fix types it may draft: reclass between P&L and balance sheet, correcting a 1999 difference, an
      accrual/reversal, or "no journal — here is why it is fine" (note).

UI (Tutup Buku)
- [x] Each FAIL/REVIEW row: **Jelaskan** (when AI is configured, period open) → inline panel under the row: explanation,
      suggestion, cited rows as links, **Pakai sebagai catatan** (opens the note dialog prefilled; the accountant saves) and, if
      a draft was made, "Draf jurnal dibuat di *Usulan jurnal koreksi*".
- [x] Card **Usulan jurnal koreksi {periode}**: PROPOSED proposals of the period — memo, reason, lines with an account select
      each, amounts fixed; **Catat jurnal** / **Abaikan**. Shown only when there is one.
- [x] Existing "Tinjauan AI" card stays (one call for all); Jelaskan is the per-control path.

Verification
- [x] `tests/unit/close-explain.test.ts`: parser keeps a grounded balanced entry; drops an entry with an invented amount, an
      unknown or bank account, unbalanced lines, or for a group control; refs outside the control dropped; note length.
- [x] `tests/db/close-explain.test.ts` (MockProvider): Jelaskan on the loan-in-revenue control stores one proposal
      (Dr 4100 / Cr 2210 of the cited amount), a second call is served from cache (1 `AiUsage`, still 1 proposal); post with an
      edited account creates the ADJUSTMENT entry and marks POSTED; double post refused; dismiss; locked period refused; never
      posts/acks/locks on its own.
- [x] e2e: none of the investor walk changes (AI isn't configured in e2e); `verify:books` ALL PASS (no number changes).

**Gate-reopeners:** **schema migration** — enums `ProposalSource`, `ProposalStatus`, table `ProposedEntry` (unique `key`, unique
`entryId`). **AI**: a new paid call type within ADR 0009's bounds (one control's rows, same caps, budget, cache); an amended ADR
0009 note + accounting-rules 20b. No dependency, no change to posting invariants (posting only via `postJournal()` on click).

**Non-goals:** AI posting or acknowledging anything; editing amounts of a draft (post it and adjust with a free-form journal, or
dismiss); proposals for group-level controls (1199/1190/suspense queue — their fix is elsewhere); deterministic 1999 proposals
(next cycle, same table); a queue of proposals across periods.

**Assumptions:**
1. Grounding by amount equality is strict on purpose: a split across two accounts is still expressible when the parts are cited
   rows; anything else the accountant types as a free-form journal.
2. The draft note is only a prefill; a REVIEW control still needs the accountant's own save.
3. The proposal's entity is the control's entity (`kind:<entityId>` keys).

## Tasks
- [x] T1 Schema + migration + `lib/adjust/proposals.ts` (post / dismiss / list) + DB tests — accept: migration on a fresh DB; tests green.
- [x] T2 `explainControl` (gather one control, provider method + parser + prompt, cache, store proposal) + unit/DB tests — accept: tests green with MockProvider. Depends T1.
- [x] T3 UI: Jelaskan per row, inline panel, note prefill, *Usulan jurnal koreksi* card + actions — accept: browser check 1440/390 with a mock-configured AI on local demo. Depends T2. Load `ui-rules`.
- [x] T4 Docs + end-of-cycle gates — accept: ADR note, rule 20b, README; `build`, `verify:books`, `test:e2e` green.

## Implementation
- Plan: T1–T4 sequential, inline (proposal store → AI explain → UI → docs/gates).
- T1: `prisma/schema.prisma` + migration `20260927170000_proposed_entries` (enums `ProposalSource`, `ProposalStatus`; table `ProposedEntry` with unique `key` and unique `entryId` (FK RESTRICT); CHECKs: POSTED ⇔ `entryId` set, month 1–12). `lib/adjust/proposals.ts` — `readLines()` (shape + digit check on every read), `saveProposal()` (once per key, race-safe on the unique index), `openProposals()`, `postProposal()` (accounts may be replaced per line, amounts never; client chart only, never a bank account; `postJournal` ADJUSTMENT dated the period end, then PROPOSED → POSTED guarded by `updateMany … status: PROPOSED` in the same transaction), `dismissProposal()`. Tests: `tests/db/proposals.test.ts`.
- T2: `lib/ai/provider.ts` — `ControlExplainInput/Answer`, `buildControlExplainPrompt` (one control, its rows, the chart without bank accounts, `canDraft`), `parseControlExplain` (explanation required; refs only from this control; note ≤ 300; draft kept only when every account is in the chart, D = K, 2–10 lines and **every amount equals a cited row's amount** — stored as that row's own text so a cached answer re-validates identically in any currency), `amountOf`, provider + MockProvider `explainControl`. `lib/controls/ai-review.ts` — `gather()` exported. `lib/controls/explain.ts` — `explainControl()`: the control must be flagged; one `runBudgetedAi` call under the close scope limit, cached by input hash + model + `control-explain-v1`, note "Jelaskan kontrol"; entity-scoped controls may store a draft as a `ProposedEntry` (key `AI:<hash>`), group-level ones get words only. **Design change found by the test:** a draft that takes a cited *bank line* off its account is a re-classification of that line — posting it as a free ADJUSTMENT would fix the GL but leave the line mis-coded (the `pl-financing` control kept flagging, Memory kept the wrong account). Such drafts carry `bankTransactionId` and post through the reviewer's writer (`reviewTransactionTx`, split out of `reviewTransaction` so the RECLASS and the proposal commit together); the accountant may change the target account, not the line's current one. Migration regenerated with `ProposedEntry.bankTransactionId` (not shipped yet). Tests: `tests/unit/close-explain.test.ts`, `tests/db/close-explain.test.ts`.
- T3: `app/actions.ts` (`explainControlAction` — client via `getClientForFirm`, open period, AI configured; `postProposalAction`, `dismissProposalAction`), `components/app/close-panel.tsx` (*Jelaskan* on each FAIL/REVIEW row when AI is configured and the period open; inline explanation, suggestion, cited rows as links, "Draf jurnal dibuat di *Usulan jurnal koreksi*", *Pakai sebagai catatan* opens the note dialog prefilled; row text keeps a minimum width so buttons wrap on phones), `components/app/proposals-card.tsx` (*Usulan jurnal koreksi*: memo, source, reason, one account select per line — the bank line's current account locked — amounts fixed, *Catat jurnal* / *Abaikan*), `lib/adjust/proposals.ts` `proposalViews()`, `app/(app)/clients/[id]/close/page.tsx` (card when a draft is open; `aiReady` to the panel). Browser check against a local OpenAI-compatible stub (no real credit): a planted loan drawdown in 4100 → *Jelaskan* → explanation + draft Dr 4100 / Cr 2210 Rp 379.150.000 → *Catat jurnal* → "Jurnal koreksi dicatat", the `pl-financing` row gone (the bank line re-coded), and the C2 scan then flags 2210 as newly active — consistent.
- T4: accounting-rules **20b**, ADR 0009 note (decision 2's AI-drafted entries, their validation and the bank-line path), README close row.

## Verification
- T1: fresh DB `prisma migrate deploy` → "All migrations have been successfully applied."; `prisma migrate diff` vs schema → empty; lint + typecheck clean; `npm test` → Test Files 56 passed (56), Tests 410 passed (410).
- T2: lint + typecheck clean; `npm test` → Test Files 58 passed (58), Tests 416 passed (416); local DBs rebuilt from migrations, `prisma migrate diff` → empty.
- T3: lint + typecheck clean; `npm test` → Test Files 58 passed (58), Tests 416 passed (416); `npm run build` ✓; browser at 1440 px and 390 px (`scrollWidth` 390, no horizontal scroll).
- End of cycle: lint + typecheck clean; `npm test` → Test Files 58 passed (58), Tests 416 passed (416); `npm run build` ✓ Compiled successfully; `npm run demo:reset && npm run verify:books` → ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.; `npm run test:e2e` → 10 passed (53.4s); with `EVIDENCE_ENABLED=true` → 10 passed (54.4s).

## Ship Notes
- **Migration** `20260927170000_proposed_entries`: enums `ProposalSource`, `ProposalStatus`; table `ProposedEntry` (unique `key`, unique `entryId` FK RESTRICT, optional `bankTransactionId`; CHECKs POSTED ⇔ `entryId`, month 1–12). Additive; applied by `vercel-build`.
- **AI:** a new paid call type (*Jelaskan*, one control) inside ADR 0009's bounds — same row caps, the close scope limit (40 000 tokens per client-month), cached per input; logged in `AiUsage` with note "Jelaskan kontrol". Without an AI key nothing changes.
- **Behaviour change:** Tutup Buku rows get *Jelaskan*; drafts appear in *Usulan jurnal koreksi* and post only on click. A draft that moves a bank line re-codes that line (like the review queue), so the control that flagged it clears.
- No env var, no dependency. Rollback: revert the merge; the migration is additive.

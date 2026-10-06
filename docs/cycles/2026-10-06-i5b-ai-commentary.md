# I5b — Catatan manajemen: AI drafts, arithmetic checks, the accountant approves

## Context
ADR 0014 I5 asks for "AI commentary that may cite only computed numbers". I4b built the deterministic commentary of the monthly
management report (`lib/reports/management.ts` `commentary`): sentences made only from the computed figures. They are correct but
read like a checklist. Firms rewrite them by hand before sending to the owner.

This cycle applies the ADR's one AI pattern to that text:
- the model may reword and order the sentences into a short paragraph;
- a deterministic check refuses any number that is not in the computed sentences;
- only the accountant's click makes the text the one that goes into the report.

Stage: **Laporan**.

## Spec
- [x] **`lib/reports/commentary-ai.ts`**:
  - `allowedNumbers(sentences)` gives every number token in the computed sentences (amounts like `1.505.720.721`, percents like `4,8`,
    years).
  - `foreignNumbers(text, allowed)` gives the number tokens in a draft that are not allowed. A draft with any is refused and the reason
    is shown.
  - `draftCommentary(db, {firmId, clientId, entityId, year, month, provider})` builds the input: the client, the company, the month,
    the currency and the computed sentences, never raw ledger rows.
    - It runs one budgeted, cached call (`runBudgetedAi`, `EvidenceAiCache` scope `report:<client>:<period>`) and returns
      `{ text, foreign[] }`.
    - The prompt says: Bahasa Indonesia, 3–5 sentences, for a business owner, no number that is not in the facts, no advice beyond the
      facts.
- [x] **Approved text per company and month**: `ReportComment` (migration) with:
  - client, entity, year and month;
  - `text`;
  - `source` (`AI` | `ACCOUNTANT`);
  - who approved it and when;
  - the computed sentences it was checked against (a snapshot), so a later change in the books shows the note as *perlu ditinjau
    ulang*.

  It is saved only by the accountant's click, and it can be edited before saving. Numbers are re-checked on save: a foreign number is
  refused for AI text. For the accountant's own text it is allowed, with a warning, because they own their words.
- [x] **On Laporan Keuangan** (one company): a *Catatan bulan ini* card.
  - It shows the approved note, or the computed sentences when there is none.
  - *Susun dengan AI* appears when AI is configured; otherwise the card says AI is off and the computed sentences are used.
  - The draft is shown in an editable box with the number check result, then *Pakai catatan ini*.
  - *Kembali ke kalimat otomatis* deletes the approved note.
- [x] **The management workbook** puts the approved note under *Catatan bulan ini* when its snapshot still matches the books. Otherwise
  it uses the computed sentences, and when the books moved the sheet says the note was left out.
- [x] **MockProvider** `draftCommentary`: joins the facts, deterministic. Tests never call a real model.

**Non-goals:**
- commentary in the PDF statements;
- AI on other packs;
- auto-sending;
- a free-form chat.

**Gate-reopeners:** one migration (`ReportComment`). No new dependency.

**Assumptions:**
1. Numbers are the risk (ADR 0003): wording errors are visible to the accountant, but a wrong number is not. The check is on number
   tokens, not meaning, and the approval step covers meaning.
2. The cache key includes the facts, so a changed month never reuses an old draft.

## Tasks
- [x] T1 `allowedNumbers` / `foreignNumbers` + unit tests: amounts, percents, negatives in words, an invented number, a year.
- [x] T2 `ReportComment` migration + `saveReportComment` / `clearReportComment` / `reportComment` (stale when the snapshot differs) +
  `draftCommentary` with the provider method and its mock. DB tests: the AI draft is checked, foreign numbers are refused for AI, a stale
  note is detected, the cache is hit on a repeat.
- [x] T3 Card on Laporan Keuangan + actions + management workbook uses the approved note. E2e: approve a typed note and see it in the
  downloaded workbook.
- [x] T4 Gates.

## Implementation
- Plan: T1–T4 sequential, inline.
- T1: `lib/reports/commentary-ai.ts`:
  - `numberTokens`, `allowedNumbers` and `foreignNumbers`;
  - the prompt (`buildCommentaryPrompt`, facts only, JSON answer) and `parseCommentary`;
  - test: `tests/unit/commentary-ai.test.ts`.
- T2: the `ReportComment` migration `20261006200000_report_comment` and `lib/reports/report-comment.ts`:
  - `computedFacts`;
  - `reportComment`, stale when the stored facts differ from today's;
  - `noteForReport`;
  - `draftCommentary`: one `runBudgetedAi` call per facts set, cached in `EvidenceAiCache` scope `report:<client>:<period>`;
  - `saveReportComment`: refuses an AI note with foreign numbers and warns on the accountant's;
  - `clearReportComment`.

  Around it:
  - Both writes audited (`REPORT_COMMENT`); client delete removes the notes.
  - `AiProvider.draftCommentary` on the OpenAI-compatible provider and on `MockProvider`.
  - Accounting-rules 20c.
  - Test: `tests/db/report-comment.test.ts`.
- T3: the *Catatan manajemen* tab on Laporan Keuangan (one company), with `components/app/management-note.tsx`:
  - the computed sentences;
  - *Susun dengan AI* when configured, with the check shown and a refused draft unable to be saved unedited;
  - *Tulis sendiri*, *Pakai catatan ini* and *Kembali ke kalimat otomatis*.

  Around it:
  - Actions `draftCommentaryAction`, `saveReportCommentAction` and `clearReportCommentAction`.
  - `managementWorkbook` uses `noteForReport` and marks a note it left out because the books moved.
  - E2e: `e2e/management-note.spec.ts`.
  - Editing an AI draft makes it the accountant's text (`ACCOUNTANT`): the accountant now owns the wording.
## Verification
- DB tests use `MockProvider` (a deterministic draft) and an inventing provider. The inventing provider's "naik sekitar 10 % menjadi
  Rp 2 juta" is caught as `["10", "2"]`. A stale note falls back in the workbook, and a repeated draft is served from the cache (1 call).
- End of cycle (with I1d on the same branch): `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test`: Test Files 175 passed (175),
  Tests 1146 passed (1146); `npm run build` exit 0; `npm run verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground
  truth.` E2e in CI.
## Ship Notes
- Migration `20261006200000_report_comment`: a new table. No env var. AI stays optional: with no key the tab says so and the computed
  sentences are used. Rollback: revert; the table can stay.

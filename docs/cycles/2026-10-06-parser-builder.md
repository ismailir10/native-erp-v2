# Parser builder: teach Buku a new bank format from one sample

## Context
Direction approved on 2026-10-06 ([strategy plan](../strategy/2026-10-06-competitive-research-and-iteration-plan.md), Iteration 1; the
owner asked for "a parser builder: upload one statement sample, AI learns, a new bank's parser is created from the UI, no feature dev").

Today a bank Buku has not seen costs an engineering cycle. The last audit ([bank-parser-hardening](2026-09-30-bank-parser-hardening.md))
found 12 of 26 synthetic files failing or silently wrong, almost all in *vocabulary and format* (header names like `Rincian Transaksi`
or `Sisa`, date styles, a D/K column, page furniture), not in the ledger. Both readers already have the shape of a recipe: the tabular reader
(`HEADER_PATTERNS`, direction verdict, `descCols`) and the PDF reader (`HEADER`, `headerColumns`, `FOOTER`) detect columns from fixed
label lists. The oracle that makes a learned parser safe also exists: the running-balance continuity check
(`checkContinuity`, rule 12) and `repairStatement`.

**Who feels it:** the accountant onboarding a client at a bank we have no layout for. The first file decides whether they trust the product,
and today the answer is "send us a sample and wait".

**Intended outcome:** from the import page the accountant clicks *Ajarkan format ini*, uploads one sample, sees the columns Buku found with
the first rows and a green *Nyambung* verdict, fixes a column if needed, names the format and saves. Every later file of that layout
imports by itself. No deploy.

**The safety argument (why this is not "AI writes a parser").**
1. A *recipe* is **data in a closed schema**, never code and never a regex from a model.
2. A recipe is saved only if **the sample parses with its running balance proven** (every printed balance chains, opening + rows = closing).
3. Every later import through a recipe is checked the same way and shows *Ada celah* if it breaks. Nothing posts on an unproven chain beyond
   what the pipeline already allows today.
4. The AI proposes column roles from the **shape of the file** (digits and letters masked), never from the client's data. A model is
   optional: without a key the deterministic proposer and the manual column editor work.

## Spec
Scope of this first slice: **recipes for vocabulary and format variants** of table-shaped statements, in CSV/XLSX/XLS and text PDF.
Structural variants (descriptions above the amount line, multi-line headers, scans) are the next slices; the recipe version field leaves room.

- [ ] **Recipe schema** (`lib/import/recipe.ts`, zod, closed): `version 1`, `kind` TABULAR | PDF, `name`, literal header `labels` per role
      (date, description, debit, credit, amount, balance, direction flag), optional `direction` (BANK | BOOK), `sheet` hint, `furniture`
      (literal line texts to ignore, PDF), `fingerprint`. No regex, no free text executed. Every label must occur in the sample's header row.
- [ ] **Fingerprint:** a stable hash of the normalised header labels (case, spacing, currency brackets removed) + kind. Two files of one
      layout share it; a different layout does not.
- [ ] **Readers take a recipe.** `parseTabular` and the PDF `headerColumns`/`parseLines` use the recipe's labels *in addition to* the built-in
      vocabulary, and its `direction` and `furniture`. With no recipe, behaviour is byte-identical to today (all existing tests pass unchanged).
- [ ] **Deterministic proposer** (`lib/import/learn.ts`): from a sample it finds the header row (or reports it cannot), proposes roles from
      cell shapes (date-like, amount-like, a column whose values chain as a running balance, a D/K flag column), tries both sign conventions,
      detects repeated page furniture, dry-runs the reader and returns `{ recipe, preview rows, continuity verdict, notes }`. No AI, no cost.
- [ ] **AI proposer, only when the deterministic one does not chain.** One cached, budgeted call (`parser-recipe-v1`). Input = the header
      labels verbatim plus the masked skeleton of ≤ 12 rows (letters → a/A, digits → 9; dates and amounts keep their punctuation) and the
      masked preamble. Never a description, name, account number or amount. Output is validated against the closed schema; a label the sample
      does not contain, an unknown role or any extra key discards the answer. The proposal is **dry-run through the real reader** and
      shown only with its verdict.
- [ ] **Saving needs proof.** The sample must have a balance column, ≥ 5 rows, no `ParseError`, and a proven chain (after `repairStatement`).
      Otherwise the builder says why and offers the column editor; nothing is saved.
- [ ] **Storage:** `ParserRecipe` (firm-scoped): name, bank label, fingerprint, kind, recipe JSON, created by and when, enabled flag with who
      and when it was switched, last used, import count. Deleting is a soft delete (`deletedAt`, who), so the history of who taught what stays.
      **The sample file is never stored.** Preview rows live only in the request. (`AuditEvent` needs a client and a recipe is firm-wide, so it is not used.)
- [ ] **Import uses recipes.** `importStatement` loads the firm's enabled recipes. A fingerprint match is tried first; the import notes
      say *Format: <name>* (kept in the import's `parseNotes`, which the history already shows). No match: built-in readers as today. A built-in failure
      with no matching recipe now ends with *Ajarkan format ini* linking to the builder.
- [ ] **Builder UI** (Bahasa, ui-rules): reachable from the import page and from Pengaturan → *Format bank*. Steps: upload sample (PDF password
      and year questions reused) → table preview with a role dropdown over each column and the live verdict pill → name → save. Editing a
      role re-runs the dry-run. A list of the firm's formats with enable / disable / delete.
- [ ] **Tests that fail today:** three synthetic layouts built in-test, none readable now: (A) CSV `Waktu | Rincian Transaksi | Keluar (Rp) | Masuk (Rp) | Sisa`;
      (B) XLSX with a title block, header on row 7 and `Tgl Valuta | Berita | D/K | Nominal | Saldo Efektif`; (C) text PDF `Tgl | Rincian | Mutasi Debit | Mutasi Kredit | Saldo Rp`
      with `Halaman x dari y` on each page. Each: fails without a recipe, is learned by the deterministic proposer or (with `MockProvider`) the AI path,
      saves, then imports with continuity ✓. Negative tests: a sample whose chain breaks cannot be saved; an AI answer with an invented
      label, an extra key or a regex is discarded; recipes are invisible to other firms; the sample is not in the database.
- [ ] **Docs:** ADR 0014 (parser recipes; what the AI sees), a rule in `accounting-rules` (recipe = closed data, oracle-gated), `docs/real-data.md`
      rules 4–5 (what leaves the system for recipe learning: header labels and masked shapes only), README *Import* row.

**Gate-reopeners (each is part of the approval):**
- **Schema migration:** new `ParserRecipe` table, additive. No change to `StatementImport` or `AuditEvent`.
- **AI credit use:** one call per learning attempt at most, only when the deterministic proposer fails, cached by skeleton hash, under
  `reserveAiBudget` with its own scope. Tests use `MockProvider`; `ai:smoke` is not changed.
- **Change to a documented boundary:** what leaves the system for AI (real-data rule 4). Decision D1 (approved): layout and header only,
  never counterparty names or amounts.
- **No new dependency** (zod, papaparse, exceljs, unpdf are present).

**Non-goals:**
- Structural PDF variants (lead-in description above the amount line, counterparty below the row, two-line headers, multi-account
  sections) and scans or photos: next slices, scored by the Iteration 0 corpus.
- Sharing recipes across firms, a public recipe library, or editing a recipe's JSON by hand.
- Statements with no printed balance (cannot be proven; refused here).
- New `BankCode` values; the recipe's bank label is free text on the format.
- Bank feeds, e-wallet or marketplace payout sources (Iteration 1, item 4).
- Iteration 0 (corpus, scorecard): its own cycle, needs real files.

**Assumptions** (each one I would otherwise settle silently):
1. Any accountant (not only ADMIN) may teach a format. A bad recipe cannot post unproven numbers, since the chain is checked on every import.
   Deleting a format is ADMIN-only.
2. A recipe is firm-wide, not per client.
3. The sample is not stored. To fix a recipe later the accountant re-uploads a sample.
4. Header labels are bank vocabulary, not client data, so they may be sent to the AI verbatim. Preamble lines above the header
   (which can hold the account holder's name and number) are masked.
5. Locating the header row can fail on an odd file; the builder then lets the accountant click the header row instead.
6. A recipe adds to the built-in vocabulary and never removes from it, so a recipe cannot make a known bank worse.
7. The AI path is optional. With no key the deterministic proposer plus the column editor cover the same ground, only slower.

## Tasks
- [ ] T1 Recipe schema, fingerprint and validator (`lib/import/recipe.ts`), pure — accept: unit tests for valid/invalid recipes, fingerprint stability across case, spacing and `(IDR)`.
- [ ] T2 Failing fixtures A, B, C (`tests/`), built in-test — accept: each is refused today with no recipe (tests assert the current error).
- [ ] T3 Tabular reader accepts a recipe (`parseTabular`, header row, labels, direction, sheet) — depends T1 — accept: A and B parse with continuity ✓ given a hand-written recipe; the existing parser tests pass unchanged.
- [ ] T4 PDF reader accepts a recipe (`headerColumns`, labels, furniture) — depends T1 — accept: C parses with continuity ✓ given a hand-written recipe; the SMBC, BCA and Mandiri tests pass unchanged.
- [ ] T5 Deterministic proposer (`lib/import/learn.ts`: header-row finder, role shapes, balance-chain finder, furniture detection, dry-run + verdict) — depends T3, T4 — accept: A, B and C are learned with no AI and no recipe supplied.
- [ ] T6 Skeleton masking + AI proposer (prompt `parser-recipe-v1`, strict validation, budget scope, cache) — depends T1, T5 — accept: `MockProvider` answers an unfamiliar-label sample; invented labels, extra keys and regexes are discarded; masked skeleton contains no letters or digits of the sample (tested on a sample with a name and account number in the preamble).
- [ ] T7 Migration `ParserRecipe` + store (`lib/import/recipes.ts`: create, list, disable, soft delete, firm scope) — accept: DB tests for tenancy, soft delete keeping who and when, and that no file bytes are stored.
- [ ] T8 Pipeline: `importStatement` loads recipes, fingerprint match first, notes and history name the format, built-in failure error links to the builder — depends T3, T4, T7 — accept: DB test imports a layout-A file through a saved recipe, rows and continuity as expected; a second firm's identical file does not use it.
- [ ] T9 Server actions (`learnFormatAction` preview, `saveFormatAction`, `setFormatEnabledAction`, `deleteFormatAction`) — depends T5–T8 — accept: action tests for validation, proof gating, tenant and role checks.
- [ ] T10 Builder UI + format list + CTA on the import error (load `ui-rules`) — depends T9 — accept: manual walk in the browser with fixtures A–C; Bahasa copy; no layout shift on re-run; works with no AI key.
- [ ] T11 e2e: teach layout A, then import it, in the investor-walk project — depends T10 — accept: Playwright passes against `next start`.
- [ ] T12 Docs: ADR 0014, `accounting-rules` rule, `real-data.md` rules 4–5, README row, ADR index — accept: links resolve; no fact hand-written that the code owns.

## Implementation

## Verification

## Ship Notes

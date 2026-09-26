# Evidence questions see unconfirmed documents · FX import keeps Kurs and rounding honest

## Context
A local end-to-end run on real client files (Chickin, Goers, Filosofi Kopi — 26 Sep 2026; findings in
`data/private/reports/local-e2e-2026-09-26.md`, private) posted 215 journals and balanced the Neraca, but exposed two
groups of defects an accountant hits on day one.

**1. Questions on a new document collection answer nothing.** `askEvidence()` (`lib/evidence/answers.ts:185-194`) builds a
`sourceRange` whenever a period exists — from the *Periode* field or from a date the AI plan extracts ("Desember 2024") — and
then admits only units with a **confirmed selection whose period fits**. A freshly uploaded collection has no confirmed
selections, so every dated question is empty. The *Periode* field is worse: it reads the global `period` URL param
(`components/app/evidence-workspace.tsx:79`), so opening a 2024 collection from a page scoped to Dec 2025 silently filters to
Dec 2025. Observed: "Berapa Penjualan Minuman Desember 2024?" → nothing; the same question without the date → the right
passage. "Profil perusahaan" → nothing although 13 company-name facts exist. Separately, 3 of 7 AI answer plans were rejected
("Rencana jawaban AI tidak valid") and fell back to plain search.

**2. Foreign-currency ledger import.** Three defects on the Chickin HoldCo GL (SGD books, USD/IDR lines):
- *File rates overwrite the Kurs table.* `upsertFileRate()` (`lib/fx/rates.ts:33`) protects only MANUAL rows; the file's flat
  `Rate: 1.3669` (Feb 2024–Dec 2025) replaced existing rates on ~90 dates, including 31-12-2025, and revaluation then proposed
  at 1,3669 instead of 1,2855 (≈ S$750k on one receivable). Kurs is per firm, so one client's stale rate reaches every client.
- *Conversion rounding blocks posting.* `planLedger()` (`lib/ledger-import/check.ts:166-199`) rounds only non-converted lines
  into 7190; the sub-unit residue of converting several USD lines stays in `imbalance` → 10 BLOCK "tidak seimbang" items of
  ±S$0,01 on journals that balance exactly in USD.
- *The Drive handoff can't convert.* `prepare()` (`lib/evidence/review.ts:186`) calls `stageImport` without `currencyMode`,
  so a sheet from Dokumen can only post foreign lines as written; the accountant must leave Dokumen and re-upload in
  *Impor → Buku besar* to choose *Konversi dengan kurs*.

Outcome: a question on a just-uploaded folder finds its evidence and says what isn't confirmed yet; a foreign-currency GL can be
converted from Dokumen, posts without spurious rounding blocks, and never rewrites rates the firm already has.

## Spec
Evidence questions (`lib/evidence/answers.ts`, `lib/ai/provider.ts`, `components/app/evidence-workspace.tsx`)
- [ ] A unit is left out of an answer only when it is **known** to be out of scope: a confirmed selection for another entity,
      or a known period outside the range (confirmed selection period, else the unit's extracted table/period). Units with an
      unknown entity or period stay in, and the answer adds one limitation: `N bagian belum dikonfirmasi entitas/periodenya; ikut dicari.`
- [ ] Applies to every document intent (SEARCH, COMPARE, CONTEXT, MISSING) and to dates from the AI plan as well as the field.
- [ ] CONTEXT ("Profil perusahaan") returns PROPOSED/CONFLICTING facts of in-scope units, labelled as today ("belum dikonfirmasi").
- [ ] The *Periode* field on a collection starts empty and uses its own URL param (`tanya`); the global `period` no longer
      narrows questions. Choosing a month still works and survives reload.
- [ ] `parseEvidenceAnswerPlan()` treats optional fields that are `null` or `""` as absent. Unknown keys, bad dates and
      out-of-context entity ids are still rejected.

FX in ledger import (`lib/fx/rates.ts`, `lib/ledger-import/check.ts`, `lib/ledger-import/post.ts`)
- [ ] File rates **only fill empty dates**: `upsertFileRate` never updates an existing Kurs row, whatever its source.
- [ ] When a file rate differs from the Kurs row on the same date/pair, the draft shows REVIEW `FX_FILE_RATE_DIFFERS`:
      `Kurs USD→SGD di file 1,3669 berbeda dari Kurs 1,2855 (31 Des 2025). Baris dikonversi dengan kurs file; tabel Kurs tidak diubah.`
      (one item per pair, listing up to 5 dates + count). Row conversion is unchanged: the row's own rate wins (faithful to file).
- [ ] Conversion rounding: in CONVERT mode, when a group balances **per currency in its source amounts** (Σ signed source
      amount = 0 for every currency in the group), the functional residue after conversion is posted to **7190** as rounding
      (memo `Selisih pembulatan konversi kurs`), not BLOCK — provided |residue| ≤ number of converted lines (minor units).
      Otherwise behaviour is unchanged (BLOCK, acceptable into 1999).
- [ ] Rounding memo for non-IDR entities no longer says "sen ke Rupiah" (`Selisih pembulatan` + currency-neutral wording).

Drive handoff (`lib/evidence/extract.ts`, `lib/evidence/review.ts`, `components/app/evidence-workspace.tsx`, `app/actions.ts`)
- [ ] Ledger/Neraca table units record `table.currencies` (distinct row currencies) at extraction (units JSON — no migration).
- [ ] A confirmed SOURCE table unit whose `currencies` include one other than the confirmed currency (or whose `currencies`
      is unknown — older extractions) shows **Baris valas**: *Jumlah sudah dalam mata uang entitas* (default, as manual import)
      / *Konversi dengan kurs*. The choice goes to `stageImport({ currencyMode })`; the draft header already states the mode.
- [ ] IDR-only (single-currency) units show no extra field.

Docs
- [ ] `docs/real-data.md` §5/§6 and `docs/evidence-workspace.md`: file rates fill gaps only; conversion from Dokumen; question
      scope rule.
- [ ] `.claude/skills/accounting-rules` 6a/6b: FX conversion residue of a per-currency-balanced group → 7190; file rates never
      overwrite Kurs.

**Gate-reopeners:** no schema migration, no new dependency, no AI credit in tests (MockProvider). **Accounting invariant
touched:** rule 6a is extended (conversion residue → 7190, same principle as sen rounding) and rule 6b's "taken from the file"
becomes "fills gaps only" — both called out for approval.

**Non-goals:** reading figures from Jurnal.id exports / side-by-side neraca (findings 15, 26); current vs non-current mapping
(18); source-account names in balance questions (17); rule suggestions shown before the AI click; first-click hydration;
revaluation logic; changing an existing draft's currency mode (cancel and prepare again); repairing rates already overwritten
in production (none known — production Chickin HoldCo was posted as-is, no file rates saved).

**Assumptions:**
1. "Known period" of an unconfirmed unit = its extracted `table.periodStart..periodEnd` (or `date` for a neraca); units without
   either are unknown → included.
2. In COMPARE, unconfirmed units still need `unit.entity` from extraction (unchanged); this cycle only stops scope filtering
   from hiding them.
3. Per-currency balance uses the file's raw signed amounts in cents (`debit − credit`) per `row.currency` (functional-currency
   rows under the entity's currency). The ≤ n-lines bound keeps a real mis-conversion from hiding as rounding.
4. A file rate equal to the existing Kurs row (same decimal after `formatRate`) raises nothing.
5. Model choice is config, not code: local runs switch to `kimi-k3` (smoke-tested: 13,8 s, valid JSON; `kimi-k2.6` is 403
   "Model access is disabled"). Product hint text (`CHAT_MODEL_HINT`) and production Pengaturan are unchanged unless you say so.

## Tasks
- [x] T1 Question scope excludes only known-out-of-scope units; limitation for unconfirmed ones; CONTEXT includes proposed facts — accept: DB test on a collection with **no** selections: dated question (field and plan) returns the passage; confirmed-other-entity unit and confirmed-out-of-range unit excluded
- [x] T2 Lenient optional fields in `parseEvidenceAnswerPlan` — accept: unit test `{"intent":"SEARCH","terms":["x"],"from":null,"entityId":""}` parses; unknown key still throws
- [x] T3 *Periode* field on its own `tanya` param, empty by default (depends T1) — accept: `/documents/<id>?period=2025-12` shows empty field; choosing a month sets `tanya=` and the answer scope
- [x] T4 File rates fill gaps only + REVIEW `FX_FILE_RATE_DIFFERS` (reuse `formatRate`, `lookupRate`) — accept: DB test: existing FILE and MANUAL rows untouched after posting; differing file rate yields one REVIEW per pair
- [x] T5 Conversion residue of per-currency-balanced groups → 7190; currency-neutral rounding memo; accounting-rules 6a/6b text — accept: unit test (3 USD lines, residue 1 → rounding, no BLOCK; mixed USD/SGD unequal group → BLOCK unchanged); DB test posts with 7190 line and `postJournal` fx check passes
- [x] T6 `table.currencies` at extraction; *Baris valas* choice in Dokumen; `prepareEvidenceImportAction(…, currencyMode)` → `stageImport` (depends T5) — accept: evidence review DB test stages CONVERT draft with converted lines; UI shows the field only for multi-currency/unknown units
- [x] T7 Docs (`real-data.md`, `evidence-workspace.md`) + local re-run on `buku_real`: FKM dated question answers, Chickin HoldCo via Dokumen with *Konversi* shows 6 real differences (not 16) and no Kurs rows changed — accept: results recorded in Verification

## Implementation
- Plan: tasks T1–T7 sequential, done inline (T1/T3 and T5/T6 share files; slices too small to delegate).
- T1: `lib/evidence/answers.ts` (`sourceScope`), `tests/db/evidence-scope.test.ts`, `tests/unit/evidence-answers.test.ts` — units are excluded only when confirmed for another entity or with a known (confirmed, else extracted) period outside the range; passage/fact queries use `NOT (excluded)`; unconfirmed units counted in a limitation. Unit test updated: an *unconfirmed* other-entity sheet is now searched (the spec's rule), a *confirmed* one is still dropped.
- T2: `lib/ai/provider.ts` (`parseEvidenceAnswerPlan`), `tests/unit/evidence-ai.test.ts` — optional fields `null`/`""` dropped before validation; a lone `from` or `to` becomes a one-day range (previously a plan with only `from` passed the parser and then failed the question in `rangeFor`). Unknown keys (`note: null`) still rejected.
- T3: `components/app/evidence-workspace.tsx` — question period reads/writes `tanya`; the app-wide `period` is only carried on the "Semua dokumen" link.
- T4: `lib/fx/rates.ts` (`upsertFileRate` insert-only), `lib/ledger-import/post.ts` (`fileRateChecks`), `tests/db/rates.test.ts`, `tests/db/ledger-import.test.ts` — file rates only fill empty Kurs dates; a differing existing rate yields one REVIEW `FX_FILE_RATE_DIFFERS` per pair (latest 5 dates + count), mode-aware wording.
- T5: `lib/ledger-import/check.ts` (per-currency source sums, `fxRounding`), `lib/ledger-import/post.ts` (memo), `.claude/skills/accounting-rules` 6a/6b, `tests/unit/ledger-check.test.ts`, `tests/db/ledger-import.test.ts` — residue ≤ n converted lines of a group balanced in every source currency moves from `imbalance` to `rounding` (7190, "Selisih pembulatan konversi kurs"); rounding memo no longer says "ke Rupiah". `lib/controls` STATS wording untouched (still labels the total IDR — noted, out of scope).
- T6: `lib/evidence/{types,extract,review,workspace}.ts`, `app/evidence-actions.ts`, `app/actions.ts`, `components/app/evidence-workspace.tsx`, `tests/db/evidence-handoff.test.ts` — `table.currencies` at extraction; *Baris valas* (FieldDescription copy as in the manual import) for confirmed SOURCE ledger units with another/unknown currency; `prepareImport(…, currencyMode)`. **Found while verifying (needed for the spec's "cancel and prepare again"):** discarding a draft left `evidenceSelection.importId` pointing at the deleted import, so Dokumen kept a dead "Buka hasil impor" link and never offered "Siapkan impor" again. Discard now clears the link in the same transaction; `prepare()` and the workspace loader ignore links to imports that no longer exist (heals existing ones).
- T7: `docs/real-data.md` §5/§6, `docs/evidence-workspace.md` — Baris valas in Dokumen, conversion rounding rule, file rates fill gaps only, question scope rule and `tanya`.

## Verification
- T1: new DB test fails on old code (`expected [] to deeply equal [ 'Dec24!12', 'PnL!12' ]`), passes after. Gate: lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 365 passed (365)`.
- T2: gate lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 366 passed (366)`.
- T3 (browser, local `buku_real`, kimi-k3): `/documents/<FKM>?scope=all&period=2025-12` → Periode field empty; "Berapa Penjualan Minuman Desember 2024?" → 30 cited passages incl. `4 1 01 01 | Penjualan Minuman | 1125635898.336` (was: "Tidak ada bukti yang cocok"); limitation "13 bagian belum dikonfirmasi entitas/periodenya; ikut dicari."; AiUsage kimi-k3 264/346 ok. Gate: lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 366 passed (366)`.
- T4: new ledger-import test — FILE-source 1,2855 kept after posting a file with `Rate: 1.3669`; REVIEW message asserted verbatim. Gate: lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 367 passed (367)`.
- T5: unit — 3 USD lines at 1,3669 → lines 1368/1368/−2737, rounding +1, no BLOCK; USD 150.000 vs "SGD 150.000" still BLOCK S$46.500,00. DB — posts via `postJournal` with one 7190 debit 1 "Selisih pembulatan konversi kurs", no 1999. Gate: lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 370 passed (370)`.
- T6: DB test — extraction `currencies: ["USD"]`; prepare as written → discard → workspace shows `importId: null` → prepare with CONVERT → lines 13500/−13500 with fx USD 1.35, no FX_NO_RATE. Browser (local Chickin, old extraction): 10_HC_GL_MASTER shows *Baris valas* + *Siapkan impor* again after the earlier discard; 04 neraca shows no field. Gate: lint ✓, typecheck ✓, `Test Files 48 passed (48) · Tests 371 passed (371)`.
- T7 (local `buku_real`, real Chickin workbook, Kurs = 836 manual ECB rows): Dokumen → 10_HC_GL_MASTER → *Konversi dengan kurs* → *Siapkan impor* is refused with "Sheet … sudah diimpor (26 Sep 2026)" (HOLDCO already posted — duplicate guard correct). Staged the same sheet with CONVERT for a scratch client "Uji konversi HOLDCO (scratch)" in the same firm (draft deleted afterwards, nothing posted): 165 journals, **7 BLOCK (was 16)** — 9 pure conversion-rounding journals now go to 7190 (net −S$0,01). Spec estimate said 6: 31 Jan 2024 −S$2,30 exceeds 1 minor unit per converted line, so it stays a real difference (correct per rule). REVIEW `FX_FILE_RATE_DIFFERS`: "… pada 125 tanggal (31 Des 2025: file 1,3669, Kurs 1,2855; …)". Kurs rows 836 → 836, 0 changed. FKM dated question: see T3.

## Ship Notes

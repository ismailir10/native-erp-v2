---
name: accounting-rules
description: Non-negotiable accounting invariants for Buku's ledger, import pipeline, classifier, AI usage, reports and close controls. Load before touching lib/ledger, lib/import, lib/ledger-import, lib/fx, lib/classify, lib/ai, lib/reports, lib/controls or prisma/.
---

# Accounting rules (break one = a bug, even if tests pass)

Lineage: these come from the one-time chickin/belifi reconciliation work (bank mutation → GL → TB → FS,
"GL = single source of truth, no hidden plugs, 3-layer verification") turned into a product.

## Ledger
1. **GL is the single source of truth for Buku books.** Never store derived ledger balances. Versioned source-reported figures in `lib/evidence/` are evidence, explicitly labeled separately, and never feed Buku financial reports directly (ADR 0007). TB, Laba Rugi, Neraca, combined worksheet,
   charts and tax card are all derived from `JournalLine` at read time (`lib/reports/*`).
2. **`postJournal()` (`lib/ledger/post.ts`) is the only writer.** It enforces Σdebit = Σcredit, ≥2 lines,
   one positive side per line, open period, accounts in the entity's client COA. The DB also CHECKs
   `debit>=0, credit>=0, (debit=0) <> (credit=0)` (init migration). Never `prisma.journalLine.create` elsewhere.
3. **Posted entries are immutable.** Corrections = new entry. Bank lines change via `postBankTransaction()`,
   which posts a **RECLASS of the difference** on the classification side only; the bank side never changes.
4. **Locked periods reject every write** — imports, reclasses, adjustments. Unlock is explicit (`unlockAction`).
5. **Opening balances** are `OPENING` entries; the plug goes to 3200 Saldo Laba. Prior-year P&L folds into 3200 in the TB.

## Money
6. `bigint` **minor units of the entity's functional currency** everywhere in the domain (ADR 0006). IDR has exponent 0,
   so for IDR entities that is whole Rupiah, as before. Parse with `parseRupiah()` / `parseMinor()` (handles `1.234.567,00`,
   `1,234,567.00`, `(2.500)`), format with `formatRupiah()` / `formatMoney(value, currency)`. Convert to `Number` only for chart
   pixels. Across the server→client boundary pass bigint as string. Never add amounts of entities with different currencies
   without translating first (rule 11).
6a. **IDR sen:** source amounts with sen round half-up per line to whole Rupiah; the entry's residue goes to one line on
   **7190 Selisih Pembulatan** (`roundEntry()`). Never spread it silently over other lines. Same for conversion: when a ledger
   group balances in every source currency, the ≤ 1 minor unit per converted line left after converting goes to 7190
   ("Selisih pembulatan konversi kurs"); a larger residue, or a group that doesn't balance per currency, is a real difference.
6b. **Foreign-currency lines** keep `currency`, `fxAmount` (minor units) and `fxRate` (decimal string, functional per 1 unit);
   `postJournal` checks `round(fxAmount × fxRate) = functional amount` (±1 minor unit). Rates are `ExchangeRate` rows (typed in
   or taken from the file) — never fetched live. A file rate only **fills an empty date**; it never overwrites a Kurs row (the table
   is per firm), and a differing one is shown as REVIEW `FX_FILE_RATE_DIFFERS` on the draft. Month-end revaluation is **proposed** to **7200 Laba/Rugi Selisih Kurs** and
   posted only by an explicit click.
7. Dates are date-only `@db.Date` (UTC midnight). Read with `getUTC*`. Use `dateOnly()` / `periodBounds()`.
8. PPN split: tagged lines split gross → DPP + PPN at `PPN_EFFECTIVE_PERCENT` (11% = 12% × 11/12). `dpp + ppn === gross` always. It's an estimate — label it.

## Chart of accounts (per client, shared by its entities so combined reports line up)
9. Special codes are load-bearing — never renumber: **1190** intercompany, **1199** transfer clearing,
   **1999** suspense (Belum Terklasifikasi), **3200** retained earnings, bank GL accounts **1101–1109**,
   overdraft (PRK) bank accounts **2201–2209**, **7190** rounding, **7200** FX gain/loss, **3900** translation difference.
9a. An entity's own codes live in `SourceAccount` (per entity), each mapped to exactly one client account. Imported lines keep
   `sourceAccountId`; the *Akun sumber* TB groups by it. Mapping suggestions (rules → AI on **names only**) are applied only by the
   accountant's explicit click; an import can't post while any source account is unmapped.
10. Same-entity transfer → 1199 (must net to 0). Cross-entity → 1190, posted in *each* entity's books,
    eliminated in the combined worksheet (receivable vs payable, matched = min). Residual ≠ 0 → REVIEW.
11. PT + owner individual combined is a **management "Gabungan"**, not SAK consolidation. Keep the label + tooltip.
    Gabungan / Beranda are in IDR: non-IDR entities are translated — assets & liabilities at the closing rate, income & expense at
    the period's average rate, equity at the historical rate; the residue is the equity line **3900 Selisih penjabaran**. A missing
    rate shows the entity as *belum dijabarkan* — never a number computed with a guessed rate.

## Import & classification (`lib/import/pipeline.ts`)
12. Parse → continuity check (opening + Σ = every printed balance → closing) → dedupe by row hash → classify → post, all-or-nothing in one transaction.
13. Order: **transfer matcher → rules (client before firm) → memory → AI → heuristic.** Transfer matching needs a
    textual hint (TRSF/PINDAH BUKU/own entity name) — equal amounts alone are never enough.
14. **Only deterministic methods (TRANSFER/RULE/MEMORY, confidence ≥ 0.9) auto-post.** AI and heuristic results
    post to **1999** with `NEEDS_REVIEW` and a prefilled suggestion. Reviewer accept → reclass + Memory upsert.
15. Every bank-derived entry carries `bankTransactionId`; `BankTransaction` keeps `rawRow`, `rowNumber`, `importId`.
    Every ledger-derived entry carries `ledgerImportId` + `sourceRef` (`sheet!row` range) and its lines keep their row refs.
    That chain is the product's trust story — don't break it.
15a. **Ledger / Neraca import** (`lib/ledger-import`): read → check → map → post, all-or-nothing in one transaction, via
    `postJournal()` (kind `IMPORTED`, or `OPENING` for Neraca). Checks are deterministic and cite rows: BLOCK (non-numeric cell,
    missing date/account, unbalanced group, unknown currency, missing rate) stops posting; an unbalanced group may be **explicitly
    accepted**, which posts its difference to 1999 with memo "Selisih dari file sumber". Same file twice for the same entity is refused.
16. Parsers detect format from **content**, not file name, and raise `ParseError` with a Bahasa message the UI shows verbatim.

## AI (credit is limited — treat every call as money)
17. LLM runs **outside** DB transactions, only for leftovers, **one request per unique merchant key + direction**,
    batched (≤40/call), cached in `AiSuggestion` with firm/client isolation (key implementation: `lib/ai/classify.ts`).
    Account mapping (rule 9a) follows the same discipline: names + type hints only (no amounts, no descriptions), ≤40 per call,
    cached by `(normalised name, type hint, coaVersion)`, whitelisted against the client chart, counted in the same caps.
18. All paid paths reserve the shared monthly allowance atomically through `lib/ai/budget.ts` before network calls. Evidence context proposals and read-only query plans use bounded source passages, versioned citations, and scope/model/prompt caches; monetary answers are deterministic tool results (ADR 0007). Existing classification/mapping payload restrictions still apply. Hard caps: `AI_MAX_CALLS_PER_IMPORT`, `AI_MONTHLY_TOKEN_BUDGET`; every call logged in `AiUsage`. No retry loops.
19. Bank text is untrusted: output codes must be in the client's COA whitelist (`parseAiResponse`), else dropped.
20. Tests and the seed **never** call a real model (`MockProvider`, pre-cached answers). `npm run ai:smoke` is the only live call.
21. Provider is OpenAI-compatible `fetch` (OpenCode Zen default) behind `AiProvider`; swap by config, not code.
    Key + model: **Pengaturan (DB, encrypted) overrides env** — resolve via `resolveAiConfig()` (`lib/settings/ai.ts`).
    `AI_BASE_URL` stays **env-only** so a visitor can't redirect the stored key. *Cek koneksi* hits `GET /models` (no tokens).

## Close
22. Controls (`lib/controls`): TB balanced, A = L + E, bank statement balance = GL per account, continuity,
    1199 = 0, 1999 empty, 1190 eliminated, ledger-import checks (accepted BLOCK = FAIL, REVIEW = REVIEW),
    FX revaluation posted when a foreign-currency balance exists. **REVIEW ≠ bug** — it needs a human note. **FAIL blocks** Tutup Buku.
23. Tutup Buku requires: no FAIL, every REVIEW acknowledged with a note, all sign-offs ticked.

## Tenancy
24. Every row has `firmId`. Server actions resolve the client through `getClientForFirm()` before any write.

---
name: accounting-rules
description: Non-negotiable accounting invariants for Buku's ledger, import pipeline, classifier, AI usage, reports and close controls. Load before touching lib/ledger, lib/import, lib/classify, lib/ai, lib/reports, lib/controls or prisma/.
---

# Accounting rules (break one = a bug, even if tests pass)

Lineage: these come from the one-time chickin/belifi reconciliation work (bank mutation → GL → TB → FS,
"GL = single source of truth, no hidden plugs, 3-layer verification") turned into a product.

## Ledger
1. **GL is the single source of truth.** Never store balances. TB, Laba Rugi, Neraca, combined worksheet,
   charts and tax card are all derived from `JournalLine` at read time (`lib/reports/*`).
2. **`postJournal()` (`lib/ledger/post.ts`) is the only writer.** It enforces Σdebit = Σcredit, ≥2 lines,
   one positive side per line, open period, accounts in the entity's client COA. The DB also CHECKs
   `debit>=0, credit>=0, (debit=0) <> (credit=0)` (init migration). Never `prisma.journalLine.create` elsewhere.
3. **Posted entries are immutable.** Corrections = new entry. Bank lines change via `postBankTransaction()`,
   which posts a **RECLASS of the difference** on the classification side only; the bank side never changes.
4. **Locked periods reject every write** — imports, reclasses, adjustments. Unlock is explicit (`unlockAction`).
5. **Opening balances** are `OPENING` entries; the plug goes to 3200 Saldo Laba. Prior-year P&L folds into 3200 in the TB.

## Money
6. `bigint` integer Rupiah everywhere in the domain. Parse with `parseRupiah()` (handles `1.234.567,00`,
   `1,234,567.00`, `(2.500)`), format with `formatRupiah()`. Convert to `Number` only for chart pixels.
   Across the server→client boundary pass bigint as string.
7. Dates are date-only `@db.Date` (UTC midnight). Read with `getUTC*`. Use `dateOnly()` / `periodBounds()`.
8. PPN split: tagged lines split gross → DPP + PPN at `PPN_EFFECTIVE_PERCENT` (11% = 12% × 11/12). `dpp + ppn === gross` always. It's an estimate — label it.

## Chart of accounts (per client, shared by its entities so combined reports line up)
9. Special codes are load-bearing — never renumber: **1190** intercompany, **1199** transfer clearing,
   **1999** suspense (Belum Terklasifikasi), **3200** retained earnings, bank GL accounts **1101–1109**.
10. Same-entity transfer → 1199 (must net to 0). Cross-entity → 1190, posted in *each* entity's books,
    eliminated in the combined worksheet (receivable vs payable, matched = min). Residual ≠ 0 → REVIEW.
11. PT + owner individual combined is a **management "Gabungan"**, not SAK consolidation. Keep the label + tooltip.

## Import & classification (`lib/import/pipeline.ts`)
12. Parse → continuity check (opening + Σ = every printed balance → closing) → dedupe by row hash → classify → post, all-or-nothing in one transaction.
13. Order: **transfer matcher → rules (client before firm) → memory → AI → heuristic.** Transfer matching needs a
    textual hint (TRSF/PINDAH BUKU/own entity name) — equal amounts alone are never enough.
14. **Only deterministic methods (TRANSFER/RULE/MEMORY, confidence ≥ 0.9) auto-post.** AI and heuristic results
    post to **1999** with `NEEDS_REVIEW` and a prefilled suggestion. Reviewer accept → reclass + Memory upsert.
15. Every bank-derived entry carries `bankTransactionId`; `BankTransaction` keeps `rawRow`, `rowNumber`, `importId`.
    That chain is the product's trust story — don't break it.
16. Parsers detect format from **content**, not file name, and raise `ParseError` with a Bahasa message the UI shows verbatim.

## AI (credit is limited — treat every call as money)
17. LLM runs **outside** DB transactions, only for leftovers, **one request per unique merchant key + direction**,
    batched (≤40/call), cached forever in `AiSuggestion` keyed by `(merchantKey, direction, coaVersion)`.
18. Hard caps: `AI_MAX_CALLS_PER_IMPORT`, `AI_MONTHLY_TOKEN_BUDGET`; every call logged in `AiUsage`. No retry loops.
19. Bank text is untrusted: output codes must be in the client's COA whitelist (`parseAiResponse`), else dropped.
20. Tests and the seed **never** call a real model (`MockProvider`, pre-cached answers). `npm run ai:smoke` is the only live call.
21. Provider is OpenAI-compatible `fetch` (OpenCode Zen default) behind `AiProvider`; swap by env, not code.

## Close
22. Controls (`lib/controls`): TB balanced, A = L + E, bank statement balance = GL per account, continuity,
    1199 = 0, 1999 empty, 1190 eliminated. **REVIEW ≠ bug** — it needs a human note. **FAIL blocks** Tutup Buku.
23. Tutup Buku requires: no FAIL, every REVIEW acknowledged with a note, all sign-offs ticked.

## Tenancy
24. Every row has `firmId`. Server actions resolve the client through `getClientForFirm()` before any write.

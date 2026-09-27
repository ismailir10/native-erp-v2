# Close you can trust — sanity controls + AI review before lock

## Context
Hard test on real files (27 Sep, private scorecard `data/private/reports/close-scorecard-2026-09-27.md`):
parsing and posting are faithful (Chickin 3,724/3,724 account×month balances tie to the file, all reports balance),
but **close controls prove arithmetic, not truth**. A real SMBC month closed green and said *"Laporan siap dikirim ke
klien"* while a Rp 300 jt loan drawdown sat in Penjualan, loan repayments in Beban umum, and — with AI guesses
accepted — total assets were **−Rp 377 jt**. A Goers month with no data at all also locked green.

Who feels it: the accountant who trusts the green page, and the firm that sends the report. Outcome: Buku refuses to
call wrong-looking books "ready", says exactly why, and AI explains each flag and proposes the fix — the first step of
the Rillet-style "AI watches the books" direction. AI proposes, never posts (new **ADR 0009**).

This reorders the approved plan (C1 → C5): C2 goes first because it removes the most dangerous failure. C1 (client's own
GL first) follows.

## Spec
Deterministic sanity controls (`lib/controls/sanity.ts`, called from `runControls`, per entity at period end; each REVIEW
needs a note as today, each carries `href` to where to fix it):
- [x] **Total aset negatif → FAIL** `nature-total:<entity>`: "Total aset Rp −377.515.023 — tidak mungkin; cek klasifikasi."
- [x] **Saldo berlawanan sifat → REVIEW** `nature:<entity>`: balance-sheet accounts (ASET, LIABILITAS) whose net is opposite
      their `normalBalance`, excluding 1190, 1199, 1999 and contra accounts (their `normalBalance` already says so).
      Detail lists up to 5 accounts with amounts ("1130 Piutang Usaha saldo kredit Rp 398.000.000").
- [x] **Pembiayaan di Laba Rugi → REVIEW** `pl-financing:<entity>`: bank transactions dated in the period, classified to a
      PENDAPATAN/BEBAN account, whose description matches financing words (PINJAMAN, LOAN, PRK, PLAFON, ANGSURAN, POKOK,
      SETORAN MODAL, MODAL, DEPOSITO, PENEMPATAN, PINDAH BUKU, OVERBOOK, ANTAR REKENING) and **not** interest/fee words (BUNGA,
      INTEREST, BIAYA, FEE, ADM, PAJAK, MATERAI). Detail: count, total, top 3 ("Pinjaman - Loan Rp 300.000.000 → 4100").
- [x] **Bulan tanpa data → REVIEW** `activity:<entity>`: no journal line dated in the period while the entity has lines
      both before and after it, or (for the last month) before it and no statement/ledger coverage for the period.
      Months before an entity's first line are not flagged.
- [x] **Tebakan diterima tanpa diubah → REVIEW** `guess:<entity>`: bank transactions dated in the period with status
      REVIEWED and method HEURISTIC, or method AI with confidence < 0.6 (reviewer didn't change it). Detail: count + total.
- [ ] Demo stays clean: `verify:books` ALL PASS and the investor e2e still reaches the lock with zero *Perlu dicek*. If a new
      control flags demo data, the demo reviewer step or the scenario is corrected, not the control silenced.

AI review before lock (`lib/controls/ai-review.ts`, `lib/ai/provider.ts`, close page):
- [x] ADR 0009 **AI in the close**: AI reads the period's REVIEW/FAIL controls plus their supporting rows and returns, per
      control, an explanation and a proposed action; it never posts, acks, ticks or locks. Every item cites control keys and
      row ids it was given; anything else is dropped. Payload bounds: only flagged controls, ≤ 40 rows, descriptions ≤ 80
      chars, amounts included (allowed by this ADR, unlike classification/mapping). Budgeted and cached like evidence calls.
- [x] `AiProvider.reviewClose?(input)` + `buildCloseReviewPrompt` + `parseCloseReview` (strict JSON; unknown keys/ids
      dropped; empty → "AI tidak memberi tinjauan yang valid"). Timeout = evidence timeout (90 s).
- [x] `reviewClose(db, firmId, clientId, year, month, provider)` gathers flagged controls + rows (bank tx: date, description,
      amount, account, method, confidence; ledger/1999 items: journal date, memo, amount), runs through `runBudgetedAi`
      (scope `close:<clientId>:<yyyy-mm>`, scope limit 12k tokens), caches by hash(input, model, prompt version) in the
      existing generic cache table (`EvidenceAiCache`, scope `close:…`) so reopening the page costs nothing.
- [ ] Close page: card **Tinjauan AI** above the controls when any control is REVIEW/FAIL. Button *Tinjau dengan AI*;
      result lists each flagged control → explanation, *Saran*, links to cited rows (review / ledger). Rules-only mode shows
      "AI belum diatur di Pengaturan — kontrol tetap berjalan." Locked period: card hidden. Button disabled while running.
- [ ] Tests: unit (prompt bounds, parser drops foreign ids), DB (each sanity control on synthetic fixtures; review with
      `MockProvider`, cache hit makes 0 calls; budget reservation settled). No real model in tests.

**Gate-reopeners (approve with this spec):** (1) **new paid AI path** + **new payload kind with amounts and bank
descriptions** — ADR 0009 defines its bounds; (2) **close invariant change**: accounting-rules §22 gains the sanity
controls, and "Total aset negatif" is a new FAIL that blocks Tutup Buku. No schema migration, no new dependency, no env var.

**Non-goals:** AI-proposed journal entries (C4); fixing 1999 differences (C3); client-COA-first GL (C1); flux / month-over-
month analysis; auto-ack or prefilled ack notes; classifier changes (loan lines, transfer matcher window — separate cycle);
sanity checks on ledger-imported lines' descriptions (their text isn't stored per line).

**Assumptions:**
1. Financing keywords are a fixed Bahasa/English list in code; false positives are fine because REVIEW only needs a note.
2. Negative total assets is always wrong → FAIL. Negative equity is legitimate (deficit) → not checked.
3. "Tebakan" threshold 0.6 — HEURISTIC is 0.3, AI answers seen on real data were 0.35–0.5 for guesses, ≥ 0.7 for confident ones.
4. Reusing `EvidenceAiCache` (generic key/scope/payload JSON) avoids a migration; rename is a later cleanup if it grows.
5. The AI sees amounts and short bank descriptions of the flagged rows only — same data the accountant sees on screen,
   sent to the configured provider (OpenCode Zen). No names beyond what the bank text contains.

## Tasks
- [x] T1 ADR 0009 + accounting-rules §22/§AI update — accept: `docs/adrs/0009-ai-in-the-close.md`, ADR index, skill text; lint passes.
- [x] T2 Sanity controls (`lib/controls/sanity.ts`, wired in `runControls`) + DB tests per control; demo still all-PASS — accept: `npm test` green incl. `tests/db/demo.test.ts`, new `tests/db/sanity-controls.test.ts`. Reuse `trialBalance`, `periodBounds`, `formatMoney`.
- [x] T3 AI close review core: provider method, prompt, parser, `reviewClose` with budget + cache — accept: unit + DB tests with `MockProvider` (0 calls on cache hit, reservation settled). Depends T2. Reuse `runBudgetedAi` (`lib/ai/budget.ts`), `resolveProvider` (`lib/settings/ai.ts`).
- [ ] T4 Close page card *Tinjauan AI* + server action (`getClientForFirm` tenancy) — accept: typecheck, local browser check on a flagged period, investor e2e green. Depends T3. Load `ui-rules`.
- [ ] T5 Real-data rerun (local `buku_real`, one real AI review on the SMBC month) + end-of-cycle gates — accept: SMBC May 2026 no longer locks without notes; Chickin lockable months unchanged except flagged ones explained; private scorecard updated; `build`, `verify:books` ALL PASS, `test:e2e` green.

## Implementation
- Plan: T1–T5 sequential, done inline (each task builds on the previous: controls → review core → UI → real-data rerun).
- T1: `docs/adrs/0009-ai-in-the-close.md`, `docs/adrs/README.md`, `.claude/skills/accounting-rules/SKILL.md` — ADR 0009; rules 20a (AI close review bounds) and 22a (sanity controls).- T2: `lib/controls/sanity.ts`, `lib/controls/index.ts`, `tests/db/sanity-controls.test.ts` — five sanity checks per entity, emitted only when they flag; a clean entity gets one PASS row *Kewajaran pembukuan*. Empty-month check is skipped when a bank control already says the statement is missing, and months before the entity's first line are never flagged (spec's "before and after" simplified to "after the first line"). Financing link opens the ledger of the P&L account. Demo check: all demo investor clients stay `sanity=PASS` for Jun–Aug 2026.
- T3: `lib/ai/provider.ts` (`CloseReview*` types, `buildCloseReviewPrompt`, `parseCloseReview`, real + mock `reviewClose`), `lib/controls/ai-review.ts` (`reviewClose`, `cachedCloseReview`), `lib/controls/sanity.ts` (`flaggedBankRows` shared), `tests/unit/close-review.test.ts`, `tests/db/close-review.test.ts`. Rows per flagged control: financing/guess → the bank lines; nature → bank lines booked to non-bank balance-sheet accounts this month; suspense → open review lines; ledger import → its BLOCK/REVIEW checks with amounts. ≤ 10 rows per control, ≤ 40 total. **Deviation:** per-month scope limit 40k tokens, not 12k — the reservation estimate (prompt bytes + 3k completion) would allow only one review per month at 12k. `cachedCloseReview` lets the page show a paid review without calling AI; the cache key includes the input, so any fix invalidates it.

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 48 passed (48), Tests 373 passed (373).
- T2: lint + typecheck clean; `npm test` → Test Files 49 passed (49), Tests 376 passed (376).
- T3: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 382 passed (382).
## Ship Notes

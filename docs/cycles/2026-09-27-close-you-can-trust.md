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
- [x] Demo stays clean: `verify:books` ALL PASS and the investor e2e still reaches the lock with zero *Perlu dicek*. If a new
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
- [x] Close page: card **Tinjauan AI** above the controls when any control is REVIEW/FAIL. Button *Tinjau dengan AI*;
      result lists each flagged control → explanation, *Saran*, links to cited rows (review / ledger). Rules-only mode shows
      "AI belum diatur di Pengaturan — kontrol tetap berjalan." Locked period: card hidden. Button disabled while running.
- [x] Tests: unit (prompt bounds, parser drops foreign ids), DB (each sanity control on synthetic fixtures; review with
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
- [x] T4 Close page card *Tinjauan AI* + server action (`getClientForFirm` tenancy) — accept: typecheck, local browser check on a flagged period, investor e2e green. Depends T3. Load `ui-rules`.
- [x] T5 Real-data rerun (local `buku_real`, one real AI review on the SMBC month) + end-of-cycle gates — accept: SMBC May 2026 no longer locks without notes; Chickin lockable months unchanged except flagged ones explained; private scorecard updated; `build`, `verify:books` ALL PASS, `test:e2e` green.

## Implementation
- Plan: T1–T5 sequential, done inline (each task builds on the previous: controls → review core → UI → real-data rerun).
- T1: `docs/adrs/0009-ai-in-the-close.md`, `docs/adrs/README.md`, `.claude/skills/accounting-rules/SKILL.md` — ADR 0009; rules 20a (AI close review bounds) and 22a (sanity controls).- T2: `lib/controls/sanity.ts`, `lib/controls/index.ts`, `tests/db/sanity-controls.test.ts` — five sanity checks per entity, emitted only when they flag; a clean entity gets one PASS row *Kewajaran pembukuan*. Empty-month check is skipped when a bank control already says the statement is missing, and months before the entity's first line are never flagged (spec's "before and after" simplified to "after the first line"). Financing link opens the ledger of the P&L account. Demo check: all demo investor clients stay `sanity=PASS` for Jun–Aug 2026.
- T3: `lib/ai/provider.ts` (`CloseReview*` types, `buildCloseReviewPrompt`, `parseCloseReview`, real + mock `reviewClose`), `lib/controls/ai-review.ts` (`reviewClose`, `cachedCloseReview`), `lib/controls/sanity.ts` (`flaggedBankRows` shared), `tests/unit/close-review.test.ts`, `tests/db/close-review.test.ts`. Rows per flagged control: financing/guess → the bank lines; nature → bank lines booked to non-bank balance-sheet accounts this month; suspense → open review lines; ledger import → its BLOCK/REVIEW checks with amounts. ≤ 10 rows per control, ≤ 40 total. **Deviation:** per-month scope limit 40k tokens, not 12k — the reservation estimate (prompt bytes + 3k completion) would allow only one review per month at 12k. `cachedCloseReview` lets the page show a paid review without calling AI; the cache key includes the input, so any fix invalidates it.
- T4: `app/actions.ts` (`closeReviewAction`: tenancy via `getClientForFirm`, budget/answer errors verbatim, provider 5xx/timeout → "AI tidak tersedia saat ini…"), `components/app/close-review-card.tsx`, close page. The page shows a cached review (no call) via `cachedCloseReview`, reusing the controls it already computed. Card hidden when nothing is flagged or the month is locked; rules-only mode says AI isn't configured. Label *Usulan AI*, no icons/hype (ui-rules).
- T5: rerun on local `buku_real` found two gaps, fixed here. (1) *Tidak ada transaksi bulan ini* fired 63× on Chickin, whose GL posts a few aggregated entries per year: a month inside a posted LEDGER file's date range that holds this entity's entries now counts as covered (`lib/controls/sanity.ts`, new test). (2) The AI saw no rows for a ledger-fed *Saldo berlawanan* and the wrong checks for a ledger FAIL: the review now sends the client's source accounts that make up each flagged Buku account (`src:<id>`, linked to *Akun sumber*) and puts BLOCK checks before REVIEW ones (`lib/controls/ai-review.ts`, new test). Completion cap raised 3k → 6k after kimi-k3 truncated once (reasoning tokens); the failed call was logged `ok=false`, not cached.
- Review fixes (Codex on PR #22): `nature` sends only bank lines booked to the listed accounts and `nature-total` only non-bank assets, so unrelated descriptions never leave the database; a cited row must belong to the control it was sent with; the card hides the re-review button while a review is shown (the cache would return it unchanged) and the page remounts the card when the flagged set changes.
- Codex review on PR #23: a negative asset total is now explained by the non-bank asset accounts carrying credit balances plus the month's bank lines booked to those accounts or to non-asset accounts; asset-to-asset transfers (which can't move the total) are no longer sent.

## Verification
- T1: lint + typecheck clean; `npm test` → Test Files 48 passed (48), Tests 373 passed (373).
- T2: lint + typecheck clean; `npm test` → Test Files 49 passed (49), Tests 376 passed (376).
- T3: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 382 passed (382).
- T4: lint + typecheck clean; `npm test` → 51 files / 382 tests passed. Browser, local `buku_real` on :3001, real SMBC May 2026 (reopened): card lists 2 flags (*Pinjaman / modal / pindah dana tercatat di Laba Rugi*: 5 transaksi Rp 703.605.746; *Tebakan diterima tanpa diubah*: 17 transaksi). One real review, kimi-k3, 39 s, 2,330 + 2,387 tokens: named the Rp 300 jt out 18/5 / in 19/5 as a probable own-account transfer, proposed Dr 4100/Kr 2210 for a drawdown, Dr 2210 + Dr 7110 / Kr 6190 for instalments, 1199 for transfers, cited the 5 rows. Reload served it from cache (AiUsage count unchanged at 17). 390 px: scrollWidth = clientWidth = 390.- T5 real data (private scorecard updated): SMBC May 2026 no longer locks without notes (2 flags); Goers empty June needs a note; Chickin 31/36 months still lockable, now with 56 real notes (SKP 1140 credit Rp 616 jt ×36, CSP Kas Kecil −Rp 5 jt ×16, HOLDCO AR credit, CAH PPh 21 debit, 2 ledger findings). Real AI reviews: SMBC 39 s, 2,330 + 2,387 tokens; Chickin Mar 2023 39 s, 2,362 + 2,993 tokens — traced SKP 1140 to source SKP-UNM-12 "[UNMAPPED] Lainnya" Cr Rp 691.152.675 and proposed Dr 1140 / Cr 2120; named the CSP Rp 5 jt unbalanced journal behind the FAIL.
- End of cycle: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 384 passed (384); `npm run build` ✓; `npm run demo:reset && npm run verify:books` → `ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth.` (without the reset it failed on a local demo DB already changed by earlier e2e runs); `npm run test:e2e` → 9 passed (29.8s), investor walk still locks with zero *Perlu dicek*.
- Review fixes: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 386 passed (386).
- PR #23 follow-up: lint + typecheck clean; `npm test` → Test Files 51 passed (51), Tests 387 passed (387).

## Ship Notes
- **No migration, env var or dependency.** AI close reviews cache in the existing `EvidenceAiCache` table (scope `close:<clientId>:<yyyy-mm>`).
- **Behaviour change:** Tutup Buku now blocks on *Total aset negatif* (FAIL) and asks for notes on the four new REVIEW checks. Existing clients with real anomalies (e.g. Chickin in production) will show new *Perlu dicek* rows; previously locked months stay locked.
- **AI cost:** only when the accountant clicks *Tinjau dengan AI*: ~5k tokens per review on real data, ≤ 40k per client-month, shared monthly budget; cached until the flagged set changes. Rules-only mode unaffected. Bank descriptions (≤ 80 chars) and amounts of flagged rows go to the configured provider (ADR 0009).
- Rollback: revert the merge. No data to undo; cache rows are inert.

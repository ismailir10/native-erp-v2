# Transfer and review safety (use-case feedback, cycle 2) + login value proposition

## Context
This cycle comes from the owner's use-case document (2 Oct 2026); the review that ordered the cycles is in the no-plug cycle
([2026-10-02-no-plug-golden-test](2026-10-02-no-plug-golden-test.md)). The one real money bug in the document is UC-B2: Rp 100 jt and
Rp 300 jt withdrawals to an external supplier netted to zero in 1199, only because a credit of the same amount sat on another account.
Buku's matcher (`lib/classify/transfer.ts`) has the same weaknesses:
- it pairs on a transfer hint word plus an equal opposite amount;
- among several candidates it auto-picks the nearest date;
- it never refuses a pair whose description names a third party;
- a pair can't be undone;
- AI may propose 1190/1199.

UC-B3 asks that a learned decision for reseller A never overwrites reseller B, that the owner question list sorts by amount and can be
exported, and that money accepted on the default guess shows as a share, not only a count.

The owner also asked for the login page to say what Buku does, in at most three points.

Spec approval: the owner said "continue with the transfer safety cycle" and then, before leaving, "get things done, address all feedback,
get them merged". So this cycle runs without a separate approval stop.

## Spec
- [x] **No pair across a third party (UC-B2).** Two lines pair only when neither description names anyone besides the group's own
      entities. A name counts when something is left after removing:
      - the channel and transfer words (`isGenericKey`);
      - bank names;
      - the group's own entity names;
      - own-transfer words (*pemilik*, *antar rekening*, *sendiri*, …).

      A refused line is classified like any other: rules, memory, AI, guess. The unpaired-hinted rule (1199/1190 for a line naming an own
      entity) also needs a clean description.
- [x] **Exactly one candidate (UC-B2).** An outgoing line pairs only when exactly one incoming line qualifies, and that incoming line
      qualifies for no other outgoing line. Otherwise every line involved goes to Review with the transfer account suggested and a
      reason naming the candidates (date, account, amount). Nothing is auto-picked.
- [x] **Undo a pair (UC-B2).** *Lepas pasangan* in the bank line's ledger drawer unlinks both halves, moves both back to Review on 1999
      through the existing writer (RECLASS of the difference), and marks them so a later import never pairs them again. A locked month
      refuses.
- [x] **AI never proposes 1190 or 1199 (UC-B2).** Both accounts are dropped from the account list sent to the model and from the
      whitelist that a cached or returned answer must pass.
- [x] **Counterparty-keyed decisions (UC-B3).** Test: five Rp 100 jt payments on one date to five resellers each keep their own
      decision; *Terima serupa* on one reseller touches none of the others.
- [x] **Owner question list (UC-B3).** Ask Buku's "perlu ditanyakan ke klien" lists lines by amount, largest first. Review gets
      *Unduh daftar pertanyaan* (Excel): every line waiting in Review, largest first, with date, account, description, in/out, amount,
      Buku's suggestion and an empty *Jawaban klien* column.
- [x] **Default-guess leakage (UC-B3).** The *Tebakan diterima tanpa diubah* control also states the share of the month's money in or
      out it represents.
- [x] **Login value proposition.** The login page shows three short points next to the form (below it on phones): statements to
      financial statements, every number traceable to its bank row, a close that is checked before it is locked. All three are true
      today.

**Non-goals:** splitting one bank line across accounts (needs posting changes; its own cycle). Changing the 2-business-day window (the
owner wrote ≤ 3 days; still pending their answer, and 2 business days already spans a weekend). Unpaired hinted lines naming another
group entity stay auto-posted to 1190 at 0.92: it's not an expense default, the intercompany control tracks the open half, and changing it
would rewrite the demo story. Owner-name detection for clients without an owner entity.

**Gate-reopeners (flagged):**
- **Schema migration:** `BankTransaction.pairRefused` (boolean, default false).
- **Classification rule change:** accounting-rules 13 is amended (transfer matcher conditions; AI chart without 1190/1199). A one-time
  effect on the AI cache: the classification cache key includes the account list, so merchants already cached are asked once more.
- No new dependency.

**Assumptions:**
1. Own-transfer words and bank names are a fixed list in `lib/classify/transfer.ts`. A word missing from it can only send an own transfer
   to Review (safe), never pair two strangers.
2. The demo and golden transfers carry no third-party words, so `verify:books` and the golden key are unchanged. Both are re-run to show it.
3. The value proposition is static copy, Bahasa, no hype words (ui-rules), shown on the login page only.

## Tasks
- [x] T1 Matcher: third-party refusal + exactly-one-candidate + reasons; `pairRefused` respected. Accept: `tests/unit/transfer*.test.ts`,
      `verify:books` ALL PASS.
- [x] T2 *Lepas pasangan*: migration, `unpairTransfer()` (lib), action, ledger-drawer button. Accept: DB test (both halves back to Review,
      never re-paired by a later import, locked month refused).
- [x] T3 AI chart without 1190/1199 (cache key and whitelist). Accept: unit/DB test.
- [x] T4 Counterparty test, owner question list (Ask Buku sort + Review Excel export), guess-control share. Accept: tests.
- [x] T5 Golden false-match trap (added once the no-plug cycle merged): two supplier withdrawals with a same-amount customer credit on the
      other account. Accept: the golden key with the trap passes, and fails with the previous matcher.
- [x] T6 Login value proposition. Accept: login renders at 1440/390, no horizontal scroll.
- [x] T7 End-of-cycle gates + accounting-rules amendment.

## Implementation
- Plan: T1–T6 sequential, inline (one module each; the matcher first because unpairing depends on its `pairRefused`).
- T1: `lib/classify/transfer.ts`: `thirdPartyName()` (what's left of the merchant key after channel words, bank names, own-transfer
  words and the group's names); pairs only clean, hinted lines with exactly one candidate on each side; an ambiguous group gets a 0.8
  transfer suggestion (Review) naming the candidates; the unpaired-hinted rule needs a clean description too; `pairRefused` lines never
  pair. Tests: `tests/unit/transfer-safety.test.ts` (new), `tests/unit/import.test.ts` (the TRF pair now passes the group's names).
  The demo's classification counts by entity × status × method are identical before and after (diffed).
- T2: migration `20261002180000_transfer_pair_refused` (`BankTransaction.pairRefused`; SQL from `prisma migrate diff` against the previous
  schema — the sandbox refuses an unattended `migrate reset` of the local DB, and `migrate dev` needs one because the local DB also holds
  the open no-plug branch's table), `unpairTransfer()` in `lib/review.ts`, `unpairTransferAction`, the pipeline skips refused lines,
  `lib/reports/account-ledger.ts` names the other half, ledger drawer *Pasangan transfer* + *Lepas pasangan*. Test: `tests/db/unpair-transfer.test.ts`.
- T3: `lib/ai/classify.ts` `aiAccounts()`, applied inside `aiCacheKey` and `suggestWithAi`, so the pipeline, *Minta saran AI* and the demo's
  pre-cached answers drop 1190/1199 alike, and a cached or fresh answer naming them fails the whitelist. Test: `tests/db/ai-no-transfer.test.ts`.
- T4: `lib/review-questions.ts` (`ownerQuestions` largest first, `ownerQuestionsWorkbook`: whole-unit currencies as numbers, others formatted —
  never minor units shown as units), route `review/export`, Review page *Unduh daftar pertanyaan untuk klien (Excel)*; Ask Buku's list sorts
  by amount; `lib/controls/sanity.ts` guess control adds the share (bigint, half up to one decimal). Tests: `tests/db/review-counterparty.test.ts`
  (new: five resellers, Rp 100 jt each, one date — five keys; *Terima serupa* touches none; next month only the decided one is Memory),
  `sanity-controls.test.ts` (share: Rp 1 jt of Rp 102 jt → 1 %).
- Merged `main` (the no-plug cycle, PR #80) into this branch: no conflicts.
- T5: `lib/demo/golden.ts` plants the UC-B2 case — 12 May PT BCA pays PT Baja Supplier Prima Rp 100 jt while CV Pelanggan Setia pays
  Rp 100 jt into Mandiri; 19 Jun UD Besi Kuat Sentosa Rp 300 jt against PT Grosir Nusa Raya Rp 300 jt; all with transfer words. 256 lines.
  `tests/golden/belifi-pattern.json` changes on purpose: PT revenue +Rp 400 jt (1.742.327.000), BCA −Rp 400 jt, Mandiri +Rp 400 jt; profit
  unchanged (the payments are HPP). The generator's guard exempts only the planted lines.
- T6: `app/login/shell.tsx` (`aside` beside the card, below it on phones), `app/login/page.tsx` (*Apa yang dikerjakan Buku*: three numbered
  points — statements to financial statements, every number traceable, a close checked before it locks; the third names the Temuan now
  on main).
- Review (independent adversarial pass over the branch diff) found five defects, all fixed:
  (1) `thirdPartyName` read real own-transfer descriptions as third parties — BCA cuts long names ("PT GEMILANG MAHAKAR"), Mandiri prints
  "Transfer Dana Masuk MCM InhouseTrf", BRI "NBMB … TGL"; and a clean half then auto-posted to 1199 while its refused counterpart went
  elsewhere → own names match as a run of ≥ 2 words with the last possibly cut, the bank print words are known, and a clean line with a
  same-amount line naming someone else on the other side goes to Review (0.8) naming it. (2) The close copilot (*Jelaskan*, AI close
  review) could still draft 1199/1190 → `aiAccounts` there too. (3) *Lepas pasangan* ignored settlements and withholding, and moving a
  paired half elsewhere in Review kept the link → refused while a half settles invoices, withholding cleared, and a half reviewed off
  1199/1190 drops the link (it is never paired again; its partner may pair with its real other half). (4) The guess share counted own
  transfers twice in its base → transfer lines left out. (5) The ambiguous reason named non-candidates and the suggestion could follow
  an unrelated line → each line's account follows its own candidates; the reason names the other lines in the group.

## Verification
- T1: `npx vitest run tests/unit/transfer-safety.test.ts tests/unit/import.test.ts` → `Tests 22 passed (22)`; `demo:reset && verify:books` →
  `ALL PASS — 1741 pemeriksaan saldo cocok dengan ground truth.`; lint + typecheck clean; `npm test` → `Test Files 122 passed (122) · Tests 915 passed (915)`.
- T2: `npx vitest run tests/db/unpair-transfer.test.ts` → `Tests 2 passed (2)`; `prisma migrate deploy` on both DBs → applied; lint + typecheck clean;
  `npm test` → `Test Files 123 passed (123) · Tests 917 passed (917)`.
- T3: `npx vitest run tests/db/ai-no-transfer.test.ts` → `Tests 1 passed (1)`; lint + typecheck clean; `npm test` → `Test Files 124 passed (124) · Tests 918 passed (918)`;
  `demo:reset && verify:books` → `ALL PASS — 1741 pemeriksaan saldo cocok dengan ground truth.`
- T4: `npx vitest run tests/db/review-counterparty.test.ts tests/db/sanity-controls.test.ts tests/db/workspace.test.ts` → `Tests 18 passed (18)`;
  lint + typecheck clean; `npm test` → `Test Files 125 passed (125) · Tests 920 passed (920)`.
- T5: with the new matcher `npx vitest run tests/db/golden.test.ts` → `Tests 7 passed (7)`; with `lib/classify/transfer.ts` from before T1 swapped in →
  `Tests 4 failed | 3 passed (7)`, `"pt.revenue": "1742327000"` expected, `"1342327000"` received (the two pairs netted in 1199), then restored.
  After the merge: lint + typecheck clean; `npm test` → `Test Files 129 passed (129) · Tests 939 passed (939)`; `demo:reset && verify:books` →
  `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- T6: `/login` in Chromium at 1440 px (points left, card right) and 390 px (card first, points below): no horizontal scroll, no console errors.
- T7 end of cycle: lint clean; typecheck clean; `npm test` → `Test Files 129 passed (129) · Tests 939 passed (939)`; `npm run build` → "✓ Compiled
  successfully"; `demo:reset && verify:books` → `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`
- `npm run test:e2e` not runnable here (Supabase Auth unreachable from the sandbox); CI runs it. The demo's classification is identical
  (diffed in T1), and no spec asserts the changed copy (login keeps its form labels; Review gets one more link).
- After the review fixes: lint + typecheck clean; `npm test` → `Test Files 129 passed (129) · Tests 940 passed (940)`; `demo:reset && verify:books` →
  `ALL PASS — 1765 pemeriksaan saldo cocok dengan ground truth.`; the demo's classification counts are again identical to before the cycle (diffed).

## Ship Notes
- **Migration** `20261002180000_transfer_pair_refused` (one boolean column, default false). Additive.
- **Behaviour changes:** equal-amount transfers whose description names a third party no longer pair (they're classified as payments);
  several candidates go to Review instead of the nearest date; *Lepas pasangan* in the ledger drawer; AI never proposes 1190/1199.
  **AI cache:** the cache key now leaves 1190/1199 out, so merchants cached before are asked once more on their next import (bounded by
  the usual per-import cap and monthly budget).
- Login shows three value points; Review has *Unduh daftar pertanyaan untuk klien (Excel)*.
- No env vars. Rollback: revert the merge; the column can stay.

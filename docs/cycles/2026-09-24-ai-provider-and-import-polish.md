# AI that actually answers + import polish from the Chickin/Goers walk

## Context
The owner walked the real Chickin workbook and the Goers Neraca through the private real-data preview in Chrome
(2026-09-24). The numbers held (Gabungan balanced, CTA = verify:real to the Rupiah), but the AI half of the story failed
and a handful of rough edges slowed the accountant down:

- **AI returns nothing, silently.** With `glm-5.3` the call succeeded (1,354 prompt tokens) but used exactly the
  220-token `max_tokens` Buku sets (60 + 40 × 4 accounts). GLM reasons before answering; the budget ran out before the
  JSON, parsing gave `[]`, and the toast said "0 saran AI dari 1 panggilan" as if the model had no opinion.
  The same budget formula is used for bank-transaction classification.
- **GPT models 503 on OpenCode Zen.** Zen serves GPT/Grok/Muse only on `/v1/responses`, Claude/Qwen on `/v1/messages`,
  Gemini on its own path; Buku calls `/chat/completions`. The Pengaturan model list offers all 80 models, so picking
  `gpt-5.6-luna` gave "AI 503 … Endpoint is unavailable." with no hint why.
- **Keyword rules mis-map:** "Account Receivable - Employee Loan" → 1130 Piutang Usaha (should be 1140);
  "Sewa Peralatan Tata Suara" (equipment rental) → 1210 Aset Tetap because "peralatan" typed it as an asset.
- **Mapping dropdown has no search.** ~70 chart accounts in a plain select; mapping 16 Chickin rows by hand was slow.
- **Kurs list is a wall:** the HoldCo import saved ~130 USD→SGD file rates, all listed flat above nothing else.
- **"Catat 168 jurnal" posted 165:** the draft count includes all-zero groups that posting skips.
- **Tambah klien:** the entity name follows the client name until edited; clicking into it and typing appends
  ("GoersPT Sanraya Adi Nattaya").
- **Average rate demanded for a year with no P&L:** HoldCo's only 2022 entry is the 31 Dec 2022 opening Neraca, yet
  Kurs asked for "Kurs rata-rata 2022".

Who feels it: the accountant mapping a new client, and the investor/consultant demo where "AI suggests, you accept"
is the headline.

## Spec
- [ ] **AI token budget fits reasoning models.** Mapping and classification requests ask for
      `max_tokens = 1500 + 60 × items` (cap 8000). Still one call per ≤ 40 items, still ≤ 3 calls per request, still
      counted against the monthly token budget (actual usage is what's recorded).
- [ ] **Truncated or unreadable answers are said out loud.** `finish_reason: "length"` → error
      "Jawaban AI terpotong (batas token)…"; a 200 with no parseable JSON → "Jawaban AI tidak terbaca…". Both are recorded
      as failed calls (`ok: false`) with the reason, shown in the toast and in Pengaturan → Panggilan terakhir. Nothing is
      cached from them. A valid JSON answer with zero usable codes still reads "0 saran AI" (that is the model's answer).
- [ ] **Only compatible models are offered.** When the gateway is OpenCode Zen, the Pengaturan model list hides models
      Zen serves on other endpoints (prefixes `gpt-`, `grok-`, `muse-`, `claude-`, `qwen`, `gemini-`, `jev-`), and saving
      one of them is refused with "Model ini tidak dilayani lewat /chat/completions di OpenCode Zen. Pilih mis. glm-5.3,
      kimi-k3, deepseek-v4-pro." Other gateways are untouched. An `AI 503 … Endpoint is unavailable` error adds the same hint.
- [ ] **Keyword rules:** employee/staff/karyawan/related-party receivables and loans → 1140, not 1130; rental names
      (`sewa`, `rent`, `rental`, `lease expense`) and pay names (`honor`, `gaji`, `upah`, `salary`, `wages`) infer BEBAN
      before asset words like "peralatan", so "Sewa Peralatan Tata Suara" → 6120 Beban Sewa. Existing Chickin/Goers
      suggestions don't regress (verify:real + unit tests).
- [ ] **Searchable mapping select.** "Akun Buku" in Pemetaan akun is a combobox: type "6150" or "pemasaran" to filter,
      grouped as today, "+ Buat akun baru" stays first, keyboard works. Same accessible name (`Akun Buku untuk <kode>`).
- [ ] **Kurs list grouped.** Manual rates listed as today. File rates collapse to one row per pair and file
      ("USD → SGD · 128 kurs dari chickin.xlsx · 3 Jan 2023 – 31 Des 2025"), expandable to the full list with delete.
- [ ] **Journal count is honest.** The draft's "N jurnal" / "Catat N jurnal" counts only groups that will post
      (at least one non-zero line, rounding or source difference). Posted count equals the button.
- [ ] **Tambah klien:** while the first entity's name is still auto-filled, focusing the field selects its text so typing
      replaces it.
- [ ] **Average rate only when there is P&L.** Kurs no longer asks for a year's average when the entity has no
      PENDAPATAN/BEBAN movement that year, and translation doesn't need it either (no FxMissingError for a zero P&L).
      Closing and historical needs are unchanged.

**Non-goals:** calling `/responses` or `/messages` (GPT/Claude via Zen); changing the default gateway; fixing the
HoldCo IDR row in Chickin (an accounting judgement for the consultant — needs a Jurnal Penyesuaian); entity-kind
default; any change to posted data on the real-data preview.

**Gate-reopeners:** no schema migration, no new dependency (combobox is the vendored base-ui one), no accounting
invariant change. **AI credit:** tests stay on MockProvider/fake fetch; verification makes ~1–2 real calls on the
real-data preview (owner already approved sending account names to the gateway).

**Assumptions:**
1. The Zen endpoint split is a documented gateway fact (opencode.ai/docs/zen); a prefix filter is acceptable and is
   updated by hand if Zen moves models.
2. 1500 + 60/item is enough for GLM/Kimi/DeepSeek-class reasoning on ≤ 40 accounts; the monthly 200k budget covers
   ~40 such calls. No `reasoning_effort` parameter (not portable across gateways).
3. "Honor"/"gaji" typing an account as BEBAN is safe because liabilities keep winning when the name also says
   payable/utang/accrued (existing guard).
4. Grouping file rates is display only; lookups (`closingRate`, `averageRate`) are unchanged.

## Tasks
- [x] T1 AI budget + truncation/unreadable errors in `lib/ai/provider.ts`, surfaced by `lib/ledger-import/mapping.ts`
      and `lib/ai/classify.ts` — accept: unit tests with fake fetch (`finish_reason: length`, prose-only answer, good answer)
- [x] T2 Zen model compatibility: filter in `fetchModels`, refuse on save, 503 hint (`lib/settings/ai.ts`, provider) —
      accept: unit tests for filter/refusal; non-Zen base URL unaffected
- [x] T3 Keyword rule fixes in `lib/ledger-import/mapping.ts` — accept: unit tests for the 4 names above + existing
      mapping tests green; `npm run verify:real -- chickin goers` unchanged
- [x] T4 Honest journal count at staging (`lib/ledger-import/post.ts`) — accept: DB test with an all-zero group: staged
      count = posted count
- [x] T5 Average-rate need + translation skip for years without P&L (`lib/fx/rates.ts`, `lib/reports/fx.ts`) — accept:
      DB test: SGD entity with only an opening Neraca in year 1 → no average need for year 1, Gabungan translates
- [x] T6 Searchable mapping combobox (`components/app/mapping-panel.tsx`, reuse `components/ui/combobox.tsx`) — accept:
      e2e ledger walk updated to type-to-filter; browser check
- [x] T7 Kurs list grouped by pair + file (`app/(app)/clients/[id]/rates/page.tsx`, reuse `components/ui/collapsible.tsx`)
      — accept: browser check on the real-data preview's Chickin (≈130 file rates → 2–3 rows)
- [x] T8 Tambah klien select-on-focus for the auto-filled entity name (`components/app/client-form.tsx`) — accept: browser check
- [ ] T9 Verify on real-data preview: AI suggestions on "Uji AI (sintetis)" with glm-5.3, Kurs page, Goers draft — accept:
      Verification section filled

## Implementation
- Plan: tasks T1–T9 sequential, done inline (small slices touching shared files: provider/mapping/rates; no gain from delegation).
- T1: `lib/ai/provider.ts` (`maxTokensFor` = 1500 + 60/item cap 8000, `AiAnswerError` on `finish_reason: length` or no
  `{"items":[…]}` JSON, `readItems`), `lib/ledger-import/mapping.ts` + `lib/ai/classify.ts` record the billed tokens of
  failed answers, `mapping-panel.tsx` shows "AI gagal…" as an error toast.
- T2: `lib/ai/provider.ts` `chatIncompatibility()` (Zen prefixes gpt/grok/muse/claude/qwen/gemini/jev) + 503 "Endpoint is
  unavailable" rewritten to lead with the fix; `lib/settings/ai.ts` filters the model list and refuses such a model on save.
- T3: `lib/ledger-import/mapping.ts` — `inferType` reads rent/pay names as BEBAN (guarded for prepaid/payable/lease/ROU);
  the 1130 rule skips staff/related-party/loan receivables so they fall to 1140.
- T4: `lib/ledger-import/post.ts` — `willPost()` (≥ 2 lines incl. rounding/1999) filters groups at staging; the STATS check
  still reports "N jurnal bernilai nol dilewati".
- T5: `lib/fx/rates.ts` `hasYearPl()`; `rateNeeds` lists a year's average only when that year has PENDAPATAN/BEBAN lines;
  `lib/reports/fx.ts` `entityRates` doesn't demand the average then (it translates only zeros; falls back to closing).
- T6: `AccountPicker` uses the vendored grouped combobox, filters by code/name, keeps create-account first, and preserves keyboard selection. Ledger e2e covers code/name search, keyboard choice and creation; waits for each rate refresh before selecting the next missing rate.
- T7: `RateList` groups imported rates by currency pair and source filename, with count/date range and expandable original rows; manual rates remain visible. Synthetic ledger fixture covers collapsed/expanded file rates and their delete controls.
- T8: `client-form.tsx` selects the untouched auto-filled first entity name on focus. Ledger e2e types a replacement and then confirms later edits append normally; Chrome manually confirmed replacement.
## Verification
- T1 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 122 passed (122)`
- T2 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 125 passed (125)`
- T3: `npm run verify:real -- all` before/after the rule change: output identical (diff empty), ending
  "✓ Semua pemeriksaan lolos". Gate: `Test Files 23 passed (23) · Tests 125 passed (125)`.
- T4 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 126 passed (126)`
- T5 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 127 passed (127)` · `verify:books` (after demo:reset)
  "ALL PASS — 1333 pemeriksaan saldo cocok dengan ground truth." · `verify:real -- all` identical to baseline.
- T6 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 127 passed (127)`; ledger browser walk `1 passed (21.9s)`.
- T7 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 127 passed (127)`; ledger browser walk `1 passed (15.2s)`; Chrome screenshot reviewed for grouped rates. Private Chickin check follows in T9.
- T8 gate: lint ✔ · typecheck ✔ · `Test Files 23 passed (23) · Tests 127 passed (127)`; ledger browser walk `1 passed (14.3s)`.
## Ship Notes

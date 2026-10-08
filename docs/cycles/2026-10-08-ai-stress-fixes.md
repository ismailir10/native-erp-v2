# AI stress test: Tanya Buku numbers an accountant can trust, close-review advice that is sound

## Context
After the retest, an agent stress-tested Buku's AI surfaces on production through the browser (8 Oct 2026, test clients *Belifi (retest
8 Okt)* and *Chickin Group (retest 8 Okt)*, 24 AI actions, read-only). Safety held: injection, HTML/SQL, "hapus/catat" requests and
over-long input were all handled; entity-scoped balances were exact and cited (SKP BCA Rawasari Rp 27.210.777.768). What a senior
Indonesian accountant would not accept:

| # | Surface | Finding | Cause |
|---|---|---|---|
| 1 | Tanya Buku | "Utang SKP ke pihak berelasi (Chickin Pte Ltd)" → **Rp 0** from an unused "Related Party Payable", while SKP owes Chickin Pte Ltd ~Rp 116 M (21003 Rp 50,7 M; 27003 Rp 63,6 M; SKP-AUD-4 Rp 2,3 M) | `accountsNamed` scores generic words; the client's accounts name the counterparty, not "related party"; a zero account wins on score |
| 2 | Tanya Buku | At group scope "saldo BCA Rawasari PT SKP" → total cash of 5 entities; "saldo akun 10005 …" → "Akun tidak ditemukan" ×5 | the entity named in the question is ignored; one distinctive word ("Rawasari") is below the 2-word bar; `akun <code>` looks only at Buku's chart, not the client's own codes |
| 3 | Tanya Buku | "laba SKP bulan Maret 2027" → Desember 2025 figures | the month named in the question is ignored |
| 4 | Tanya Buku | "Apa yang menghambat tutup buku?" → counts only ("15 temuan belum diakui") | readiness lists no findings |
| 5 | Tanya Buku | "transfer PT Belifi ke Alfi Yandra" total Rp 667.005.000 mixes Rp 5.000 bank fees with the transfers | one total across accounts |
| 6 | Tanya Buku | "piutang karyawan" → Rp 0, missing "Advanced – Employee" Rp 73 jt | no synonym between piutang karyawan and advance/uang muka |
| 7 | Jelaskan | Text cut mid-sentence ("…kel"), "(jenis d)" labels leak, CJK characters inside Bahasa ("匹配的", "最终"); HOLDCO 1260 fails twice "terpotong (batas 4000 token)" | our own `slice(0, 400)`; the prompt names the fix types (a)–(d); no script rule; 4 000-token budget too small for a reasoning model |
| 8 | Tinjau / Jelaskan | Advice on the wrong books: PT Belifi credited to the owner's banks 1102/1103 or 3300 Prive; FX on the holdco's own transactions → 3900; overpaid PPh 21 → 1181 (PPh badan); directors' loan → piutang karyawan | the model gets one shared chart with no entity, no kind, no per-entity bank accounts and no house rules |
| 9 | Tinjau / Jelaskan | CSP "PPh badan belum dijurnal": proposes Dr 8100 / Cr 2146 for the whole tax, ignoring credits | the control's detail does not show Buku's own proposal (`currentTarget`: credits leave 1180, only PPh 29 goes to 2146) |
| 10 | Pemetaan | CSP-DTP-01 "Penghasilan Pajak Tangguhan (laba rugi)" → 1270 (balance sheet) | the deferred-tax asset rule fires when the type is unknown; nothing reads "(laba rugi)/penghasilan/manfaat" as the P&L line |

## Spec
Tanya Buku (deterministic, `lib/workspace/index.ts`)
- [ ] A month named in the question ("Maret 2027", "Desember 2025", "tahun 2025" → December) is the period answered, and the header says so; a
  month without journals says "belum ada jurnal" rather than another month's figures.
- [ ] An entity named in the question (short or full name, without legal form) narrows a client/group scope to it; for a related-party
  question the first entity named is the subject, the others are counterparties.
- [ ] `akun <code>` also finds the client's own (imported) account codes; a single distinctive name word ("Rawasari") is enough when it
  matches few accounts and is not a generic accounting word; the entity's own name words never count as account words.
- [ ] Related-party questions ("pihak berelasi", "related party", "afiliasi", "antar entitas") include the client's accounts that name another
  group entity, and 1190, on the asked side (utang → liabilities, piutang → assets); accounts with a balance are listed before zero ones;
  a zero answer is never the only row when a matching account holds a balance.
- [ ] "piutang karyawan" ↔ advance / uang muka karyawan.
- [ ] Readiness lists the open findings (title · entity, failed first, up to 10) with a link, not only counts.
- [ ] Transactions by counterparty: totals per account ("1190: keluar Rp 667.000.000; 7100: keluar Rp 5.000").

AI close review and Jelaskan (`lib/ai/provider.ts`, `lib/controls/explain.ts`, `lib/controls/ai-review.ts`)
- [ ] Output budget for Jelaskan 12 000 tokens, close review 12 000 (reasoning models); explanations end at a sentence boundary within the
  limit instead of a hard cut; the prompt no longer lists lettered fix types; any CJK/non-Latin script is removed from the text.
- [ ] Each flagged control carries its entity (name, kind) and that entity's bank accounts; house rules in the prompt: a PT/CV has no Prive —
  owner money for the company is 1190 (owed to the owner); use only the control entity's bank accounts; FX on own transactions is 7200
  (3900 is translation only); overpaid PPh 21/23 reduces 2140/2141 or goes to 1180, never 1181; a loan to directors/shareholders is a
  related-party receivable (1190/1140 with disclosure), not piutang karyawan.
- [ ] A drafted entry (Jelaskan) that uses another entity's bank account, or 3300 for a non-PERORANGAN entity, is dropped.

Controls and mapping
- [ ] "PPh badan belum dijurnal" detail shows Buku's proposal lines (e.g. "D 8100 …; K 1180 …; K 2146 …").
- [ ] Deferred tax named with laba rugi / penghasilan / manfaat / benefit / income / expense / beban → 8110, whatever the type.

**Non-goals:** a free-form LLM Tanya Buku; cross-period comparisons; English replies; historical bulk close.

**Gate-reopeners:** none of migration or dependency. AI: larger output caps raise the worst-case tokens per Jelaskan/review call (the
monthly budget still caps the total); prompts change (cached reviews/explanations re-run once).

**Assumptions:** 1. Group entities' names are the related parties Buku knows; others need their account named. 2. The house rules match
SAK EP / PSAK and Indonesian tax practice for this firm's clients. 3. Approved under the owner's standing instruction of 8 Oct 2026
("work until you are proud"), after the retest cycle.

## Tasks
- [x] T1 Tanya Buku: period and entity named in the question; client account codes and a distinctive word — accept: `tests/unit/workspace.test.ts` + `tests/db` case with a group of two entities and a client account.
- [x] T2 Tanya Buku: related party, piutang karyawan, balance-first; readiness findings; per-account totals — accept: DB test with the Chickin-shaped related-party accounts.
- [x] T3 AI explain/review: budget, sentence-end, no lettered types, script cleanup, entity context + house rules, entry guard — accept: unit tests on prompt building, `parseControlExplain`/`parseCloseReview` cleanup and the entry guard; `tests/db/close-explain.test.ts` green.
- [x] T4 PPh badan control shows the proposal; deferred-tax P&L mapping — accept: DB test on the control detail; mapping test.

## Implementation
- Plan: T1–T4 sequential, inline. T1 and T2 share `askWorkspace` and land as one commit.
- T1+T2: `lib/workspace/index.ts` — `periodIn` (month/year named → the period answered; a month without journals says so), `entitiesNamed` (short/full/bare name, longest span wins: "Chickin" inside "Chickin Ayam Hidup" is CAH), entity narrowing (first named is the subject of a related-party question), `akun <code>` over client codes too, one distinctive non-generic word (≤ 3 accounts) is enough, entity names never count as account words, `RELATED` questions take accounts naming another group entity (subject's own name words excluded) + 1190 + related-party names on the asked side, balances listed before zero accounts; readiness lists the open findings (failed first, 10); transactions totals per account; piutang karyawan ↔ advance / uang muka. Tests: `tests/unit/workspace.test.ts`, `tests/db/workspace.test.ts` (Chickin-shaped related party, client code, distinctive word, named month).- T3: `lib/ai/provider.ts` — `HOUSE_RULES` (entity's own banks, no Prive for PT/CV/foreign — owner money on 1190, FX on own transactions 7200 not 3900, overpaid PPh 21/23/4(2) to 2140/2141/2145 or 1180 not 1181, directors' loans as related-party receivables, PPh badan journal per Buku's proposal, wrong-currency suspicion before equity, Latin-script whole sentences) in both prompts; prompts get `entities` (scope, name, kind, currency, own bank GL codes; no amounts); explanation lettered types removed; `tidyAiText` strips other scripts and ends on a sentence within the cap; output caps 12 000 (review and Jelaskan), prompt versions bumped; `lib/controls/ai-review.ts` `reviewEntities`, scope limit 100 000 tokens per client-month; `lib/controls/explain.ts` passes the entities. Drafted entries already exclude bank accounts (isBank) and Prive for PT/foreign companies (existing guard), so no new entry guard was needed. Tests: `tests/unit/ai-text.test.ts`; existing close-explain/close-review tests green.
- T4: `lib/controls/index.ts` — the PPh badan control's detail ends with "Usulan Buku: D 8100 …; K 1180 …; K 2146 …" from `pack.proposals.CURRENT`; `lib/ledger-import/mapping.ts` — deferred tax named with laba rugi / penghasilan / manfaat / benefit / income / expense / beban → 8110 (template) before the asset rule. Tests: `tests/db/tax-post.test.ts`, `tests/db/mapping.test.ts`.

## Verification
- T1+T2: lint + typecheck clean; `npm test` → Test Files 184 passed (184), Tests 1213 passed (1213).- T3: lint + typecheck clean; `npm test` → Test Files 185 passed (185), Tests 1216 passed (1216).
- T4: lint + typecheck clean; `npm test` → Test Files 185 passed (185), Tests 1216 passed (1216).

## Ship Notes

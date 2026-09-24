# Cycle 1: real-data readiness (AI settings UI, PDF statements, onboarding, copy pass)

## Context
The MVP is live as a public investor demo (https://native-erp-v2.vercel.app, synthetic data, Neon `production`).
Next, the owner will bring **real company bank statements** (CSV/XLSX exports **and PDF e-statements**). Today that can't
work:
- The AI key/model can only be set through Vercel env vars. The owner wants to paste their OpenCode Zen key in the app.
- There's no way to add a real client, its entities and bank accounts, or opening balances. Only the demo seed can.
- PDF isn't parsed at all. Most Indonesian firms receive PDF e-statements, often password-protected.
- Real data must never touch the public demo DB. *Reset data demo* TRUNCATEs every table, and the URL has no login.
- The owner also wants a copy pass so no page reads like AI slop.

Who feels it: the owner (testing with a real client next), then accountants in a pilot.
Outcome: the owner can open a private deployment, paste the AI key, add a real client, set opening balances, drop in a
PDF/CSV/XLSX statement, and get to a reconciled close. Every page reads like a plain accounting tool.

## Spec
**A. AI settings in the UI**
- [ ] New firm-level page **Pengaturan** (`/settings`, in the sidebar) with an *AI* card. It shows status, current model and the stored
      key as `••••abcd` (last 4 only). The key is **write-only**: it's never sent back to the browser.
- [ ] Save key + model, clear key, and **Cek koneksi**. The check is `GET {baseUrl}/models` with the key: no tokens, no credit.
      The model is picked from that list, or typed if the list can't load.
- [ ] Saving, clearing and checking all require **`ADMIN_PASSCODE`**, compared in constant time with a ~1 s delay on failure.
      If `ADMIN_PASSCODE` is unset, the form is read-only and says which env var to set.
- [ ] The key is stored **encrypted** (AES-256-GCM, `node:crypto`, key from **`SETTINGS_SECRET`** env). If that's unset, saving is disabled with a clear message.
- [ ] Base URL stays **env-only** (`AI_BASE_URL`), so a visitor can't point the stored key at their own server.
- [ ] Resolution order: DB setting → env (`AI_API_KEY`/`AI_MODEL`) → rules-only. It's used by imports, *Aturan & AI*, and `ai:smoke`.
- [ ] The setting is deployment-wide and **survives *Reset data demo*** (its table is excluded from `truncateAll`).

**B. PDF e-statements**
- [ ] Upload accepts `.pdf` (≤ 5 MB). Text is extracted with `unpdf` (pdf.js serverless build, works on Vercel).
- [ ] Row parser for text PDFs with the common layouts: date · description · debit/credit (or amount + DB/CR) · balance.
      Opening balance comes from *SALDO AWAL* or is back-solved from the first row. Multi-line descriptions are joined. Page headers/footers are skipped.
- [ ] **Password-protected PDFs:** the UI asks for the password. It's used once and never stored or logged.
- [ ] Scanned PDF (no text layer) → `ParseError`: "PDF ini hasil scan (tanpa teks). Minta rekening koran versi e-statement atau ekspor CSV/Excel."
- [ ] PDF rows go through the **same pipeline**: continuity check, dedupe, classify, post. `rawRow` = the extracted line, `rowNumber` = page:line.
- [ ] **No AI in parsing** this cycle. Continuity (opening + Σ = printed balances = closing) is the correctness check.

**C. Real-client onboarding**
- [ ] **Tambah klien** on Beranda: name, industry, entities (PT/CV/Perorangan, NPWP optional), and bank accounts per entity
      (bank, number, label). Reuses `createClient()` (template COA + GL 1101–1109).
- [ ] **Saldo awal** per entity: date, one line per bank account plus any other account; the plug goes to 3200. Posted as `OPENING` via `postJournal()` (rule 5).
      Each bank line is prefilled from the first imported statement's opening balance when one exists.
- [ ] Beranda and every page work for a client with no imports yet (empty states, NextStep: "Impor rekening koran pertama").

**D. Private environment for real data**
- [ ] Neon branch **`real-data`** (new, from `production`, then emptied and migrated; production untouched). Vercel **Preview** env vars scoped to
      git branch `real-data`: `DATABASE_URL(_UNPOOLED)` → that branch, `DEMO_MODE=false`. It's behind Vercel login (preview protection is already on).
- [ ] General Preview deployments (PRs) point at a Neon branch **`preview`** instead of `production`, so PR builds stop migrating the investor DB.
- [ ] Local dev: Postgres 16 via Homebrew (`buku`, `buku_test`). `.env` points at localhost, and the Neon strings move to `.env.neon.local` (not auto-loaded).
- [ ] `docs/real-data.md` runbook: privacy rules, where files go (`data/private/`, gitignored), inspect → client → saldo awal → import → review → close,
      and what to send back when a format fails (header lines only, anonymised).
- [ ] `npm run inspect:statement -- <file> [--password=…]` parses without touching the DB. It prints format, account, period,
      opening/closing, row count, continuity verdict and the first/last rows.

**E. Copy pass (no AI slop)**
- [ ] Every user-facing string in `app/**`, `components/app/**`, server-action errors, `ParseError`s, metadata and toasts gets reviewed
      against `ui-rules` + `better-writing`. That means no hype, no filler, no vague adjectives, and no claims that aren't true (e.g. reset "±5 detik" when it's ~20 s in prod).
      Sentence case, accountant vocabulary, each fact once, and errors that say what happened and what to do.
- [ ] Changed strings are listed in the cycle doc (before → after), and e2e selectors are updated to match.

**Gate-reopeners (flagged):**
- **Schema migration:** new `AppSetting` table (additive).
- **New dependency:** `unpdf`.
- **Invariant change:** accounting-rules §21 "swap by env, not code" becomes "env or Pengaturan (DB overrides env; base URL env-only)".
  §20 is unchanged: *Cek koneksi* hits `/models` and uses no tokens.
- **New env vars:** `SETTINGS_SECRET`, `ADMIN_PASSCODE`.
- **Vercel Preview env change:** PRs → Neon `preview`.

**Non-goals:** auth/roles (the passcode is only a guard on the key), scanned-PDF OCR, LLM-based PDF extraction (decide after
real files: follow-up if the deterministic parser misses layouts), `.xls` (legacy Excel), per-firm AI keys, editing
or deleting clients, bank-specific PDF layouts we haven't seen (tuned when files arrive), live AI in tests.

**Assumptions:**
1. The AI setting is **deployment-wide**, not per firm. One deployment = one firm until auth lands.
2. The model list comes from OpenCode Zen `GET /models` (OpenAI-compatible). If that endpoint isn't available, the field falls back to free text.
3. I generate `SETTINGS_SECRET` and set it in Vercel (Production + Preview). **You choose `ADMIN_PASSCODE`** and set it yourself
   with a command I give you, so it never passes through chat.
4. E-statement PDFs from BCA/Mandiri/BRI are text PDFs. The first real files may still need a layout tweak; that's expected and done
   when you share them.
5. The `real-data` Neon branch starts empty (no demo firm). The first page load there creates an empty firm named "Kantor Anda"
   (renameable later), not the demo seed.
6. PR previews on Neon `preview` get the demo seed (seed-if-empty), so reviewers still see demo data.
7. The copy pass changes wording only. No layout or flow changes beyond fixing untrue or duplicated statements.

## Tasks
- [ ] T1 Local env: Homebrew Postgres 16, `buku` + `buku_test`, `.env` → localhost, Neon strings → `.env.neon.local` — accept: `npm test` green locally, `.env` has no neon.tech host
- [ ] T2 `AppSetting` model + migration; `lib/settings/secret.ts` (AES-GCM) + `lib/settings/ai.ts` (resolve DB→env); `truncateAll` skips `AppSetting`; accounting-rules §21 updated — accept: unit tests (roundtrip, tamper → error, resolution order, survives `seedDemo`)
- [ ] T3 AI provider reads resolved config (pipeline, *Aturan & AI*, `ai:smoke`) — reuse `aiConfig()` shape — accept: existing tests green; DB setting overrides env in a test
- [ ] T4 Pengaturan page + actions (save/clear/check, passcode, write-only key, `/models` list) + sidebar link — accept: unit tests for actions (wrong passcode rejected, key never in returned payload); browser check
- [ ] T5 `unpdf` + `lib/import/parsers/pdf.ts` (layout parser, password, scanned detection) + wired into `parseStatement` + upload accepts `.pdf` with password prompt — accept: unit tests on generated text PDFs (DB/CR layout, debit/kredit columns, multi-line desc, encrypted, scanned) pass continuity
- [ ] T6 `scripts/inspect-statement.ts` + `npm run inspect:statement` — accept: runs on the demo BRI CSV and a test PDF, prints verdict, no DB connection
- [ ] T7 Tambah klien (Beranda) + first-run empty firm when `DEMO_MODE=false` — reuse `createClient()` — accept: DB test creates client+entities+banks; empty-client pages render (e2e smoke)
- [ ] T8 Saldo awal form (per entity, bank lines prefilled, plug 3200, `OPENING` via `postJournal`) — accept: DB test; bank recon control Lolos after opening + first import
- [ ] T9 Copy pass across all pages/components/errors; before→after table in this doc; e2e selectors updated — accept: `npm run test:e2e` green, screenshots reviewed
- [ ] T10 Private env: Neon `real-data` + `preview` branches, Vercel Preview env (branch-scoped + general), `SETTINGS_SECRET`; `docs/real-data.md`; README env/deploy updated — accept: `real-data` Preview deploy is Ready, behind Vercel login, empty firm, Pengaturan works
- [ ] T11 End-of-cycle gates + ship (draft PR, CI green, production deploy still shows the demo) — accept: lint/typecheck/test/build/verify:books/e2e all green; prod walk unchanged

Dependencies: T1 → all. T2 → T3 → T4. T5 → T6. T7 → T8. T9 after T4/T5/T7/T8 (so it covers their copy too). T10 after T2 (migration) and T7 (empty firm).

## Implementation
## Verification
## Ship Notes

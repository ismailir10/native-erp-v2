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
- [x] New firm-level page **Pengaturan** (`/settings`, in the sidebar) with an *AI* card. It shows status, current model and the stored
      key as `••••abcd` (last 4 only). The key is **write-only**: it's never sent back to the browser.
- [x] Save key + model, clear key, and **Cek koneksi**. The check is `GET {baseUrl}/models` with the key: no tokens, no credit.
      The model is picked from that list, or typed if the list can't load.
- [x] Saving, clearing and checking all require **`ADMIN_PASSCODE`**, compared in constant time with a ~1 s delay on failure.
      If `ADMIN_PASSCODE` is unset, the form is read-only and says which env var to set.
- [x] The key is stored **encrypted** (AES-256-GCM, `node:crypto`, key from **`SETTINGS_SECRET`** env). If that's unset, saving is disabled with a clear message.
- [x] Base URL stays **env-only** (`AI_BASE_URL`), so a visitor can't point the stored key at their own server.
- [x] Resolution order: DB setting → env (`AI_API_KEY`/`AI_MODEL`) → rules-only. It's used by imports, *Aturan & AI*, and `ai:smoke`.
- [x] The setting is deployment-wide and **survives *Reset data demo*** (its table is excluded from `truncateAll`).

**B. PDF e-statements**
- [x] Upload accepts `.pdf` (≤ 5 MB). Text is extracted with `unpdf` (pdf.js serverless build, works on Vercel).
- [x] Row parser for text PDFs with the common layouts: date · description · debit/credit (or amount + DB/CR) · balance.
      Opening balance comes from *SALDO AWAL* or is back-solved from the first row. Multi-line descriptions are joined. Page headers/footers are skipped.
- [x] **Password-protected PDFs:** the UI asks for the password. It's used once and never stored or logged.
- [x] Scanned PDF (no text layer) → `ParseError`: "PDF ini hasil scan (tanpa teks). Minta rekening koran versi e-statement atau ekspor CSV/Excel."
- [x] PDF rows go through the **same pipeline**: continuity check, dedupe, classify, post. `rawRow` = the extracted line, `rowNumber` = page:line.
- [x] **No AI in parsing** this cycle. Continuity (opening + Σ = printed balances = closing) is the correctness check.

**C. Real-client onboarding**
- [x] **Tambah klien** on Beranda: name, industry, entities (PT/CV/Perorangan, NPWP optional), and bank accounts per entity
      (bank, number, label). Reuses `createClient()` (template COA + GL 1101–1109).
- [x] **Saldo awal** per entity: date, one line per bank account plus any other account; the plug goes to 3200. Posted as `OPENING` via `postJournal()` (rule 5).
      Each bank line is prefilled from the first imported statement's opening balance when one exists.
- [x] Beranda and every page work for a client with no imports yet (empty states, NextStep: "Impor rekening koran pertama").

**D. Private environment for real data**
- [x] Neon branch **`real-data`** (new, from `production`, then emptied and migrated; production untouched). Vercel **Preview** env vars scoped to
      git branch `real-data`: `DATABASE_URL(_UNPOOLED)` → that branch, `DEMO_MODE=false`. It's behind Vercel login (preview protection is already on).
- [x] General Preview deployments (PRs) point at a Neon branch **`preview`** instead of `production`, so PR builds stop migrating the investor DB.
- [x] Local dev: Postgres 16 via Homebrew (`buku`, `buku_test`). `.env` points at localhost, and the Neon strings move to `.env.neon.local` (not auto-loaded).
- [x] `docs/real-data.md` runbook: privacy rules, where files go (`data/private/`, gitignored), inspect → client → saldo awal → import → review → close,
      and what to send back when a format fails (header lines only, anonymised).
- [x] `npm run inspect:statement -- <file> [--password=…]` parses without touching the DB. It prints format, account, period,
      opening/closing, row count, continuity verdict and the first/last rows.

**E. Copy pass (no AI slop)**
- [x] Every user-facing string in `app/**`, `components/app/**`, server-action errors, `ParseError`s, metadata and toasts gets reviewed
      against `ui-rules` + `better-writing`. That means no hype, no filler, no vague adjectives, and no claims that aren't true (e.g. reset "±5 detik" when it's ~20 s in prod).
      Sentence case, accountant vocabulary, each fact once, and errors that say what happened and what to do.
- [x] Changed strings are listed in the cycle doc (before → after), and e2e selectors are updated to match.

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
- [x] T1 Local env: Homebrew Postgres 16, `buku` + `buku_test`, `.env` → localhost, Neon strings → `.env.neon.local` — accept: `npm test` green locally, `.env` has no neon.tech host
- [x] T2 `AppSetting` model + migration; `lib/settings/secret.ts` (AES-GCM) + `lib/settings/ai.ts` (resolve DB→env); `truncateAll` skips `AppSetting`; accounting-rules §21 updated — accept: unit tests (roundtrip, tamper → error, resolution order, survives `seedDemo`)
- [x] T3 AI provider reads resolved config (pipeline, *Aturan & AI*, `ai:smoke`) — reuse `aiConfig()` shape — accept: existing tests green; DB setting overrides env in a test
- [x] T4 Pengaturan page + actions (save/clear/check, passcode, write-only key, `/models` list) + sidebar link — accept: unit tests for actions (wrong passcode rejected, key never in returned payload); browser check
- [x] T5 `unpdf` + `lib/import/parsers/pdf.ts` (layout parser, password, scanned detection) + wired into `parseStatement` + upload accepts `.pdf` with password prompt — accept: unit tests on generated text PDFs (DB/CR layout, debit/kredit columns, multi-line desc, encrypted, scanned) pass continuity
- [x] T6 `scripts/inspect-statement.ts` + `npm run inspect:statement` — accept: runs on the demo BRI CSV and a test PDF, prints verdict, no DB connection
- [x] T7 Tambah klien (Beranda) + first-run empty firm when `DEMO_MODE=false` — reuse `createClient()` — accept: DB test creates client+entities+banks; empty-client pages render (e2e smoke)
- [x] T8 Saldo awal form (per entity, bank lines prefilled, plug 3200, `OPENING` via `postJournal`) — accept: DB test; bank recon control Lolos after opening + first import
- [x] T9 Copy pass across all pages/components/errors; before→after table in this doc; e2e selectors updated — accept: `npm run test:e2e` green, screenshots reviewed
- [x] T10 Private env: Neon `real-data` + `preview` branches, Vercel Preview env (branch-scoped + general), `SETTINGS_SECRET`; `docs/real-data.md`; README env/deploy updated — accept: `real-data` Preview deploy is Ready, behind Vercel login, empty firm, Pengaturan works
- [x] T11 End-of-cycle gates + ship (draft PR, CI green, production deploy still shows the demo) — accept: lint/typecheck/test/build/verify:books/e2e all green; prod walk unchanged

Dependencies: T1 → all. T2 → T3 → T4. T5 → T6. T7 → T8. T9 after T4/T5/T7/T8 (so it covers their copy too). T10 after T2 (migration) and T7 (empty firm).

## Implementation
- Plan: T1–T11 sequential, done inline. The tasks share files (actions.ts, sidebar, pipeline) and each needed a browser check, so subagents would have cost more context than they saved.
- T1 local env — Homebrew Postgres 16 (`buku`, `buku_test`); `.env` → localhost; Neon strings moved from `.env.local` (auto-loaded by Next!) to `.env.neon.local`. No commit.
- T2 `prisma/…_app_setting`, `lib/settings/{secret,ai}.ts`, `truncateAll` keeps AppSetting, accounting-rules §21 (`3ac5b18`).
- T3 `resolveProvider(db)` replaces env-only `defaultProvider()` in actions, *Aturan & AI*, `ai:smoke` (`3b98db3`).
- T4 `/settings` Pengaturan, `app/settings-actions.ts`, `components/app/ai-settings-form.tsx`, sidebar footer (`adc5ee2`).
  - Found: OpenCode Zen `GET /models` answers **without checking the key** (a fake key listed 80 models). *Cek koneksi* would have claimed a false "Terhubung", so it became *Muat daftar model*, and the page shows the **last real AI call** (ok/error) as the proof the key works. No tokens spent.
  - Found: Next 16 dev logs server-action arguments verbatim (the key + passcode printed in the terminal). Set `logging.serverFunctions: false`.
- T5 `unpdf` + `lib/import/parsers/pdf.ts` (header-driven columns, x-assignment, continuation lines, DB/CR or balance-delta signs, SALDO AWAL/AKHIR, password, scan detection), `.xls` message, `tests/pdf-fixture.ts` (PDF writer incl. RC4 R2 encryption) (`fa1ee33`).
  - Found: `npm i unpdf` dropped 26 platform binaries (rolldown/lightningcss linux/win) from the lockfile, which would have broken CI. The lockfile was rebuilt with only the `unpdf` entry (+18 lines).
- T6 `scripts/inspect-statement.ts` (`--lines`, `PDF_PASSWORD`) (`599ffbb`).
- T7 `lib/onboarding.ts`, `/clients/new`, `components/app/client-form.tsx`, first-run firm under `pg_advisory_xact_lock`, Beranda empty state (`6cce51e`).
- T8 `lib/opening.ts`, `/clients/[id]/opening`, `components/app/opening-form.tsx`, nav *Saldo Awal*, overview NextStep (`7133f1d`).
- T9 copy pass (table below) + empty states for new clients (`9565012`).
- T10 Neon `real-data` (schema-only; init resolved as applied, app_setting deployed, schema diff empty, CHECKs present) + `preview` (copy); Vercel Preview → `preview`, branch `real-data` → `real-data` + `DEMO_MODE=false`, `SETTINGS_SECRET` (Production, Preview); `docs/real-data.md`, README, CLAUDE.md, ship skill (`4fdf7ff`).
  - Found: branch-scoped Vercel env needs the git branch to exist first; pushed `real-data`. The same-SHA push didn't build, so the deployment was created via the API.
- T11 `e2e/real-client.spec.ts` (Tambah klien → import locked PDF → Saldo Awal prefilled → recon Lolos); investor script counts/timing.

### Copy changes (T9)
| Where | Before | After | Why |
|---|---|---|---|
| metadata title | Buku — tutup buku otomatis untuk kantor akuntan | Buku · tutup buku bulanan untuk kantor akuntan | "otomatis" overclaims; review is manual |
| metadata description | Mutasi rekening koran menjadi laporan keuangan yang bisa ditelusuri, dalam menit. | Rekening koran jadi jurnal, buku besar, dan laporan keuangan. Setiap angka bisa ditelusuri ke baris banknya. | tagline → what it does |
| client overview | … AI sudah menyiapkan usulan akunnya. | … Semuanya sudah punya usulan akun. | untrue when the suggestion is a rule/heuristic |
| automation chart tooltip | …% tanpa sentuhan manusia | …% dikode otomatis | hype |
| reset dialog | … lewat pipeline impor (±5 detik) … | … lewat proses impor yang sama. Butuh sekitar 20 detik … | jargon; untrue in prod |
| review empty / import result | Antrian … / Yang belum yakin masuk antrian review | Antrean … / Yang usulannya belum pasti masuk antrean review | KBBI spelling; subject was "the row" not "Buku" |
| import form | Kami cek saldo berjalan tiap baris — kalau ada baris hilang, Anda akan diberi tahu. | Saldo berjalan dicek di setiap baris. Kalau ada baris yang hilang, hasilnya ditandai Ada celah. | names the actual signal |
| import form | CSV KlikBCA, … tanggal/keterangan/debet/kredit/saldo · 2. File mutasi · atau unduh untuk dicoba tarik-lepas · Lanjut ke Tutup Buku | PDF e-statement, CSV KlikBCA, … · 2. File rekening koran · atau unduh file contohnya · Buka Tutup Buku | PDF now supported; name the thing |
| Aturan & AI | Menang atas aturan kantor · Tidak pernah dibayar dua kali · Mode aturan saja | Didahulukan dari aturan kantor · Merchant yang sama tidak ditanyakan lagi · Aturan saja | plain; consistent with Pengaturan |
| close / controls | Tanggung jawab akuntan — tidak bisa diotomatisasi · kontrol GAGAL · kontrol REVIEW belum diberi catatan | Diperiksa dan dicentang oleh akuntan · kontrol gagal · kontrol Perlu dicek belum diberi catatan | preachy; raw enum words |
| em-dash asides (7 places: tax card, memory, close NextSteps, review banner, worksheet residual, ack dialog, clearing control) | "… — …" | two sentences / comma | AI-slop tell; easier to read |
| Tambah klien placeholders | Grup Maju Bersama … | mis. Grup Maju Bersama … | placeholders are examples, not values |
| new-client overview / import history / automation | charts of zeros, empty table | "Belum ada mutasi …", "Belum ada rekening koran yang diimpor …" | empty states say what's true |
## Verification
- Between tasks: lint ✓ · typecheck ✓ · Vitest grew 28 → 55 tests, all green each commit.
- End of cycle (local Postgres):
  - `npm test`: `Test Files 12 passed (12) · Tests 55 passed (55)`
  - `npm run build`: `✓ Compiled successfully` (14 routes incl. /settings, /clients/new, /clients/[id]/opening)
  - `npm run verify:books`: `ALL PASS — 997 pemeriksaan saldo cocok dengan ground truth.`
  - `npm run test:e2e`: `2 passed (14.4s)` (investor walk + real-client walk with a password-protected PDF)
- Browser (local dev): Pengaturan wrong passcode → "Kode admin salah."; save → `••••0000 · disimpan di sini`, Aktif; clear → Aturan saja. Tambah klien → empty client pages all 200; Saldo Awal save → entry shown with 3200 plug.
- Vercel: feature preview built against Neon `preview` ("migration(s) have been applied", "Demo data present"). `real-data` preview: "No pending migrations", no seed, anonymous request → 302 Vercel SSO, logged-in Chrome → "Belum ada klien", Pengaturan read-only ("Tambahkan ADMIN_PASSCODE …"), no console errors.
- Not exercised: a real OpenCode Zen chat call (no key on this machine; `/models` only), real bank PDFs (none yet; synthetic layouts only).
## Ship Notes
- **Migration:** `20260924040734_app_setting` (additive). Applied by `vercel-build` on deploy. Already on Neon `preview` and `real-data`; production gets it on merge.
- **New dependency:** `unpdf@1.8.1` (MIT, no transitive deps).
- **Env (done):** `SETTINGS_SECRET` for Production and Preview (different values). Preview `DATABASE_URL(_UNPOOLED)` → Neon `preview`. Branch `real-data` → Neon `real-data` + `DEMO_MODE=false`.
- **Env (owner):** set `ADMIN_PASSCODE` for Production and Preview (`vercel env add ADMIN_PASSCODE production --sensitive` and the same for `preview`), then redeploy. Until then Pengaturan is read-only.
- **After merge:** `git push origin main:real-data` so the private preview runs the merged code.
- **Rollback:** revert the merge; AppSetting is unused by older code (safe to leave). Neon branches `preview`/`real-data` can stay.
- **Follow-ups:** tune PDF layouts on the first real files; decide on LLM PDF fallback after that; client edit/delete; the firm name "Kantor Anda" isn't editable yet; login (the passcode only guards the key).

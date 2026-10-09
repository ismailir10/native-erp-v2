# QA test plan — Buku end-to-end (Indonesian accounting)

Plan for the run of 2026-10-02. Results and evidence: [report.md](./report.md) · raw per-case results: [results.json](./results.json) / [results-table.md](./results-table.md) · bugs: [bugs/](./bugs/README.md).

## 1. Objective and approach

Prove that an Indonesian accounting firm can take a client from *rekening koran in* to *laporan keuangan out* and close the month, and that every number is right **by an independent calculation**, not by the app agreeing with itself.

- **Oracles.** Expected values were computed outside the app: SQL over raw `JournalLine` rows (trial balance, Laba Rugi, Neraca, ledger running balance), exact rational / BigInt arithmetic (PPN, PPh 23 gross-up, Pasal 31E, PP 55/2022, PV of leases, PKP rounding), and the repo's own `verify:books` for the demo ground truth.
- **Exploratory + scripted.** Playwright (Chromium, 1440×900, `id-ID`, `Asia/Jakarta`) drives the real UI; screenshots at every checkpoint. Edge-case files (KlikBCA CSV, generic ID/US-format CSV, XLSX, newest-first, hostile text) were generated for the run.
- **Code-informed.** Three read-only code investigations (tax/PSAK rules, pages + actions, ledger/report invariants) produced hypotheses; each was reproduced or discarded by execution before being reported.
- **Severity.** Blocker (core workflow cannot be completed) → High (books silently wrong) → Medium → Low. Blockers are fixed first; everything else is listed separately.

## 2. Environment

| Item | Value |
|---|---|
| Target | `ismailir10/native-erp-v2` @ `main` 99d9351 (Next.js 16, Prisma 7, Postgres 16). The repo named in the session (`native-erp`) is empty. |
| Database | Local Postgres 16 (`buku`, `buku_test`, `buku_e2e`); synthetic demo firm **KJA Demo & Rekan** + an extra firm created for tenant tests. No cloud database written. |
| Auth | **Local GoTrue stand-in** on `127.0.0.1:54321` (password grant, refresh, `/user`, admin create/update/delete, recover, invite). The sandbox egress policy denies `*.supabase.co`, so real Supabase Auth could not be reached. |
| Dependency | `xlsx` is pinned to `cdn.sheetjs.com` (also denied); the identical 0.20.3 release from the npm registry (`@e965/xlsx`) was aliased in `node_modules` only — manifest and lockfile untouched. |
| AI | No key configured: rules-only mode (as designed). No real model calls. |
| Browser | Chromium (Playwright), desktop and 390 px mobile. |

## 3. Scope and test cases

IDs match [results.json](./results.json). "Basis" is the accounting/tax rule the expected value comes from.

| Suite | Cases | What is checked | Basis / oracle |
|---|---|---|---|
| **A Access & tenancy** | A01–A14 | Login form, wrong/unknown credentials (no enumeration), XSS in login, reset notice identical for member/non-member, session persistence, logout + back, role gating (ADMIN/AKUNTAN), live revocation, **firm B cannot reach firm A** (17 routes, 2 Excel exports, forged scope) | Invitation-only access; tenancy |
| **B Navigation / URL** | K9, X5 | 88 malformed `period`/`entity`/`scope`/`tab` URLs across 8 pages; export with bad params | Robustness |
| **C Onboarding** | C01–C09 | Tambah klien validation (empty, whitespace, 121 chars, NPWP 15/16 digits, account 6–20 digits, duplicates, cross-firm number), XSS in names, generated COA (71 accounts) and bank GL 1101 | NPWP 15/16 digits (PMK 112/2022) |
| **E Bank import** | E01–E18 | KlikBCA CSV, identical same-day rows, re-upload, overlap, wrong account, continuity gap, empty/binary/oversize files, Indonesian vs US number formats, XLSX (Excel and SheetJS dates), newest-first, US dates, zero/huge amounts, hostile descriptions | Running-balance continuity; rows traceable to source |
| **F Money input** | K2, K4, K5, K7, N5c, probes | `parseMoney`, `parseRupiah`, `normalizeRateInput` on 30+ inputs; decimals, negatives, 20-digit amounts | Rupiah whole units; ID separator convention |
| **G Classification & tax** | G1–G5 | Review: prive, fixed asset + **PPN 11% effective**, jasa konsultan with **PPh 23 2% gross-up**, DP receipt with PPh 23 withheld by customer (1180) | PPN 12% × DPP nilai lain 11/12; PPh 23 jasa 2% |
| **H Manual journals** | K1–K8 | Balance check, decimals, negatives, same account both sides, locked month, **Balik jurnal** (mirror, once only) | Double entry; immutability |
| **I Reports** | I-TB ×8, I-PL, I-BS, X1–X6 | Trial balance for 3 clients / 4 entities (8 trial balances) vs SQL (open, movement, close, ΣD=ΣK); Laba Rugi month + YTD; Neraca A = L + E; Excel exports (sheets, draft stamp, numbers) | Derived-from-GL invariant |
| **J Close & lock** | J1–J8, LK1–LK2, U1–U3, UO1 | Lock blocked until controls noted (≥5 chars), sign-offs ticked, review empty, instalment posted; lock; posting/import into locked month refused; AKUNTAN cannot reopen; reopen needs reason ≥5 chars, clears sign-offs, logged; reverse order | Period lock; segregation |
| **M Piutang & Utang** | M1–M10 | Faktur penjualan with PPN 11% (+ rounding), duplicate no., due < issue, locked month, PPh 23 on invoice, **aging buckets = ledger**, settlement from a bank line | PSAK 109 aging; PPh 23 |
| **N Aset Tetap** | N1–N5 | Register (fiscal Kelompok 1, 48-month book life), validation, locked-month schedule start, fiscal depreciation in tax pack | PSAK 216; Pasal 11 UU PPh kelompok harta (the app cites PMK 72/2023 — that citation was not verified here) |
| **L Sewa** | L1–L3 (lease) | Lease PV (24 × Rp 5.000.000, 12 %, arrears), current/non-current split, monthly journal, register vs ledger | PSAK 116 |
| **P Persediaan** | P1–P3 | Stock opname journal to 1160/5190, HPP = awal + pembelian − akhir, negative refused | Periodic method |
| **T Pajak badan** | T1–T2b | PKP rounded down to 1000, **Pasal 31E** full (≤ Rp 4.8 M) and partial apportionment (turnover > 4.8 M), PP 55/2022 final 0.5 %, deferred tax | UU PPh Pasal 17/31E; PP 55/2022 |
| **O Saldo Awal** | O1–O2 | Opening 31 Dec 2025 with unbalanced remainder plugged to 3200; cannot be entered twice | opening balance convention (Saldo Awal) |
| **Q Multi-currency** | Q1–Q4 | Client with USD entity, rate entry formats, cross-rate | PSAK 221 |
| **V Ledger import** | V1–V3 | Flawed GL (unbalanced, broken cell, reused code) is flagged with row refs and nothing is posted; text rate parsing | Migration from Accurate/Jurnal |
| **R Tanya Buku** | R1–R5 | Deterministic profit answer vs SQL, unsupported question, XSS, length | Read-only Q&A |
| **S Settings / security** | S1–S3, advisor | AI key validation, encrypted at rest, firm scoping; Supabase security advisor (staging) | — |
| **Y Cross-cutting** | Y1–Y3 | 390 px layout on 20 pages, a11y labels/h1, page titles | WCAG basics |
| **Z Concurrency** | Z1 | Two sessions accept the same review line simultaneously | Ledger integrity |
| **Regression** | gates | `npm run lint`, `typecheck`, `test` (Vitest 862 → 868), `verify:books` (1,741 checks), `test:e2e` (28 specs) — before and after the fix | Repo CI definition |
| **Crawl** | 61 pages | Every route × every client: HTTP status, console errors, failed requests, `NaN`/`undefined`/`null` in text, screenshot | Smoke |

## 4. Out of scope / not testable here

Real Supabase Auth flows (invite e-mail, reset link, token refresh against GoTrue) · real AI model behaviour · Google Drive OAuth · scanned/real bank PDFs and password-protected PDFs (covered only by the repo's own tests) · production environment · load/performance beyond page timings · browsers other than Chromium · penetration testing beyond tenant/role/XSS/injection probes.

## 5. Regression specs

The scenarios behind the bug findings, the tax-split oracles and the access checks live on as `e2e/qa-*.spec.ts` (see [report.md §8](./report.md)).

## 6. Exit criteria

Zero open Blocker; every High/Medium has a reproducible bug report; repo gates green after any fix; every number-producing page reconciled to an independent oracle.

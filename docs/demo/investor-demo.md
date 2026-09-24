# Investor demo — 5 minutes

Automated end to end by `e2e/investor-demo.spec.ts` — if you change this script, change the test.

**Before you start:** `npm run demo:reset` (or sidebar → *Reset data demo*). Browser at 1440px, logged-in state
isn't needed (auth is out of scope). No internet or AI credit required; everything below runs offline.

---

### 0. The pitch (15 s)
> "Indonesian accounting firms still turn rekening koran into financial statements by hand in Excel —
> days per client per month. Buku does it in minutes, and every number traces back to the bank line it came from."

### 1. Beranda — the firm's month-end at a glance (30 s)
- Three clients, August 2026 close. *1/3 done, 6 transactions to review, **91% coded automatically** (up from 66% in month one).*
- The banner already says what to do: **Grup Ayam Nusantara is waiting for one bank statement.** Click **Kerjakan**.

> Talking point: *the product gets cheaper to run every month — memory and rules replace AI calls.*

### 2. Impor Mutasi — the live moment (45 s)
- Rekening *BRI Simpedes (Budi)* is preselected. Click **Pakai file contoh (BRI-5509-2026-08.csv)** (or drop the file from `public/demo/`).
- Result card: rows imported, **transfers paired automatically** (PT → owner, owner BCA → BRI), balance continuity *Nyambung*, **0 AI calls** (memory + cache), 1 line to review.

> Talking point: *no open banking in Indonesia — statements are the integration, so we made import bulletproof:
> format detection, running-balance check, dedupe on re-upload.*

### 3. Review — AI proposes, the accountant decides (60 s)
- Five lines, each with the suggested account, the reason, and confidence.
- The **Rp 185 jt "mesin pakan otomatis"**: AI suggested *5100 Pembelian* at **62% — flagged "keyakinan rendah"**.
  Change it to **1210 Aset Tetap** → *Simpan*. (Capitalise, don't expense — this is the moment accountants nod.)
- Press **Enter** four times to accept the rest. Queue empty.

> Talking point: *AI never writes to the books on its own. Every decision trains the client's memory.*

### 4. Laporan Keuangan — trace any number (45 s)
- Laba Rugi August + YTD. Click **4100 Penjualan** → Buku Besar → click any line →
  the sheet shows the **journal and the original statement row** (file, row number, raw text).
- Tab **Neraca** → balanced, with PPN split out automatically.
- Tab **Kertas Kerja Gabungan** → PT + owner side by side, **intercompany eliminated** (Rp 197 jt), *Antar entitas cocok*.
  Hover the ⓘ: it's a management combined view, not SAK consolidation — honesty that auditors appreciate.

### 5. Jurnal Penyesuaian — beyond cash basis (30 s)
- Template **Penyusutan** → 9.500.000 debit / credit → *Seimbang* → Simpan.

> Talking point: *bank data gives cash basis; adjusting entries make it accrual-ready.*

### 6. Tutup Buku — the controlled close (45 s)
- **15 controls, all Lolos**: TB balanced, A = L + E, each bank reconciled to the statement, continuity,
  clearing 1199 = 0, nothing in suspense, intercompany eliminated.
- Tick the three accountant sign-offs → **Tutup buku Agustus 2026**. Period locked; imports into it are now rejected.

### Close (15 s)
> "Three clients, one morning. The same engine scales to a firm's hundred clients — that's the business."

---

## Honest limits (have answers ready)
- **PDF statements** aren't parsed yet (next cycle; most firms receive PDFs). CSV/XLSX from KlikBCA, Mandiri, BRI + generic.
- Bank formats approximate 2026 exports — validate with real files before a pilot.
- Tax is an estimate card, not e-Faktur/Coretax. No auth/roles yet. IDR only.
- Demo data is synthetic, modelled on real engagements — no client data is shown.

## If something goes wrong
- Anything odd → sidebar **Reset data demo** (±5 s) and restart from step 1.
- Live AI instead of cache: set `AI_API_KEY`/`AI_MODEL`, run `DEMO_LIVE_AI=1 npm run demo:reset`; step 2 then makes exactly one real call.

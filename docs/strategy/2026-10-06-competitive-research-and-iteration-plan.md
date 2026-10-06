# Competitive research (Zahir, Jurnal) and iteration plan

Status: **direction approved 2026-10-06** (decisions in §6). Nothing here is built yet. Each iteration becomes its own `/spec` cycle; the first is [parser-builder](../cycles/2026-10-06-parser-builder.md).
Date: 2026-10-06.

## 0. Read this first: how solid is the research

The network policy of the research session blocked `zahiraccounting.com`, `jurnal.id`, `mekari.com`, `klikpajak.id`, Capterra and
every help center. **No competitor page was read directly.** Everything in §1 comes from search-result snippets, press coverage and
third-party comparison blogs (several written by competitors). Treat it as directional, not as a feature audit.

- Prices conflict across sources and are **not quoted as fact** below. Re-check the live pricing pages before they go in a deck.
- "No competitor does X" means "the search found no evidence of X", not proof of absence.
- Before we commit to the radical parts of the plan, someone should spend half a day on the live products (trial accounts) and on the
  list in §7. Cheaper still: allow-list those hosts for the research session.

## 1. What Zahir and Jurnal tell us

### 1.1 Zahir (PT Zahir Internasional)

| | |
|---|---|
| Shape | Desktop (since the 1990s) plus Zahir Online (SaaS), Enterprise, POS, HR, and **Zahir AI** (launched Sept 2024 with Lenna AI). Positioned "local, tax-aware, easy for non-accountants" for UMKM/SME. |
| Bank | Manual statement upload for reconciliation after transactions are keyed. No bank feed found. |
| Reports | "200+ reports", Excel/PDF; standard set Laba Rugi, Neraca, Arus Kas, Perubahan Modal. **No CALK or bank/investor pack found.** |
| Tax | Faktur Pajak print layouts, PPN, PPh 21 via the HR add-on. Whether it exports to e-Faktur/Coretax: unverified. |
| AI | A chat assistant: ask for reports, cash-flow and profit forecasts. Nothing found about reading bank statements or classifying rows. |
| Firms | No multi-client firm workspace found. Reach comes through **~1,500 partners (~300 accountant partners), a "Zahir User Certified" exam, and 80+ universities** teaching it. |
| Complaints | Thinner than Jurnal/Accurate on features; HR/ERP are separate products; manual data handling. All second-hand. |

### 1.2 Jurnal (Mekari)

| | |
|---|---|
| Shape | Cloud accounting for SME to mid-size, inside the **Mekari ecosystem**: Talenta (payroll), Klikpajak (tax, a DJP-appointed PJAP), Expense/Stream (OCR), Desty (marketplaces), Capital (financing). |
| Bank | **Cash Link**: Direct Feeds for the big banks (twice a day, last ~30 days), Smart Reconciliation (matches on amount/date/description) and Bank Rules. **Manual import is template-only**: the user copies debit/credit into Jurnal's Excel template. No PDF parsing found. Status is binary: reconciled / not yet. |
| Reports | Laba Rugi, Neraca, Arus Kas, Perubahan Modal, notes, TB; slice by department/product; PDF/Excel. Users complain about limited custom templates. No SAK-labelled client pack, no per-line drill to source found. |
| Tax | PPN/PPh push to Klikpajak, which files e-Faktur and e-Bupot and syncs to Coretax. A review says this is a **separate subscription**. |
| AI | **Airene**: insight and narrative over P&L / cash flow, shareable by email or WhatsApp. OCR for receipts. No AI for bank-row categorisation or parsing found. |
| Firms | A reseller programme (free access, recurring cashback), not an operational workspace. Jurnal Partner Network sells outsourced bookkeeping. No close tracker found. |
| Complaints | Slow imports at peak hours, limited templates, memo-only search, features gated by tier, e-Faktur extra cost, bank feeds only where banks partner, and **most client statements still arrive as PDF or Excel**. |

### 1.3 Other signals in the market

- **Accurate** has the widest ingestion (Smartlink: bank API, internet-banking, per-bank Excel/JSON), bulk and 1-to-many matching, built-in e-Faktur.
- **Kledo**: CSV import, manual reconciliation. **Xero** has the best-known matching UX (rules, memory, prediction, confidence).
- Third-party PDF-to-Excel converters for rekening koran (EZMutasi, MutasiPlus, rekeningkoran.com) exist and sell. **That is the demand signal for our wedge: the incumbents leave statement ingestion to outsiders.**
- AI-native US entrants (Rillet, Digits, Pilot, Basis, Numeric) sell autonomy: auto-match above 90–95%, AI close checklists, flux explanations,
  agents for accounting firms. None is Indonesian. Their funding claims in the snippets are unverified.
- Regulation shapes the output: **SAK EP replaced SAK ETAP from 1 Jan 2025**; SAK EMKM needs 3 components (posisi keuangan, laba rugi,
  CALK), the fuller sets need 5. **Coretax SPT Tahunan Badan** has ~24 lampiran; Lampiran 1 (financial-report reconciliation) has variants
  by business sector. Banks lend more readily on SAK-standard statements; exact bank requirements vary and are unverified.

### 1.4 What it means

1. **Both are transaction-entry-first.** The bank statement is a reconciliation afterthought, and the user keys the books. We are
   statement-first and firm-first. That inversion is the product, and nothing found contradicts it.
2. **Their AI is commentary, not bookkeeping.** Zahir AI chats, Airene narrates. Nobody found parses rows or proposes postings with
   proof. Our "AI proposes, deterministic code proves, accountant decides" is open ground.
3. **We cannot win their moats, so we should connect to them:** tax filing rails (Klikpajak/e-Faktur), payroll, POS, marketplace sync,
   the partner/certification ecosystem, a credit arm. Our clients' own systems are often Jurnal/Accurate/Zahir. We should read from and
   write to them.
4. **Scope creep is the documented failure mode.** Zahir's reviewers criticise ERP sprawl. We already ship PSAK 16/24/109/116, a tax
   pack, subledgers and inventory. That is plenty of breadth.
5. **Things worth copying:** Jurnal's bank rules and suggested matches; Accurate's 1-to-many matching and several ingestion paths;
   Xero's confidence layers; Klikpajak-style handoff instead of filing; Rillet/Numeric's exception-first close; Mekari's
   books-to-credit flywheel; Zahir's training/partner funnel as go-to-market.

## 2. Where Buku stands against your four principles

Read from the repo on 2026-10-06 (README, ADRs, `lib/import`, `lib/reports`, cycle docs).

| Principle | State | Honest gap |
|---|---|---|
| **1. Recon sources in, parsed well** | Strong on correctness: running-balance continuity, repair-only-if-the-chain-proves-it, dedupe, undo. Four named banks (`BankCode`: BCA, MANDIRI, BRI, SMBC) plus a generic reader; BNI/CIMB/Permata layouts were fixed only as header/date variants through the generic path. | **Coverage is code-per-bank and text-PDF only.** Scans, photos and image PDFs are refused. No per-row confidence in the UI. No e-wallet, payment-gateway or marketplace-payout sources. No intake channel (email, folder watch), no "what's still missing" per client-month beyond continuity. Each new layout costs an engineering cycle, and the last two cycles were silent-wrong-number repairs. |
| **2. Robust GL** | The strongest part: single writer, immutable entries, locks, subledgers, controls, 910+ tests, `verify:books`. | Depth over breadth now. Matching is 1-to-1 or FIFO; no 1-to-many/many-to-1 against invoices or payouts; rules are not a visible, editable asset the accountant owns. |
| **3. Any typical Indonesian report** | SAK EMKM/EP/Umum wording, full statement set, CALK draft, per-client format, Excel + PDF set, tax pack with koreksi fiskal. | Reports are organised **by statement, not by audience**. No bank-credit pack, investor/management pack, owner one-pager, audit/PBC pack, or Coretax Lampiran 1 mapping. No "issued as of" snapshot, so a figure can change after a report went to a bank. Commentary is not drafted. |
| **4. AI-assisted, elegantly** | Classification (cached, budgeted), mapping, close explanation with grounded draft entries, Tanya Buku, evidence Q&A. Rules-only mode works. | AI is scattered across pages as separate buttons. **No measured accuracy**, so we cannot say how often it is right or tune thresholds. AI is not used on the hardest, most valuable job: *reading a layout we have never seen*. |

Two further observations:

- The client area has about 19 routes (assets, benefits, leases, inventory, tax, receivables, rates…). A firm user meets an ERP menu.
  The product's own line is "rekening koran in, laporan keuangan out".
- The wedge ADR (0004) lists "PDF extraction: next priority" and OCR is a repeated non-goal. The left edge of the pipeline is
  where the incumbents are weakest and where we have spent least in the last few cycles.

## 3. Strategy in one paragraph

**Make Buku the close layer that accepts any source, proves the ledger, and ships any audience's report.** Spend the next quarter on
the two edges of the pipeline (intake and packs) and on one AI pattern used everywhere, and **stop adding accounting modules**. The
pattern: *AI proposes, a deterministic oracle checks, the accountant approves, the source row stays attached.* We already have the
oracle for statements (the running balance) and for the ledger (double entry and the controls). Use it to let AI cover the long tail
that hand-written parsers cannot.

## 4. The plan

Sizes: S ≤ 1 cycle, M ≈ 2–3, L ≈ 4+. A cycle is one `/spec → /build → /ship` loop as in AGENTS.md.

### Iteration 0: Measure first (S, before anything is rebuilt)

You cannot judge an overhaul without a before-picture.

- **Layout corpus** (private, `data/private/`, never committed): 30–50 real statements across banks, formats and years, from the pilot firm(s).
  Add it to `verify:real` as a scored run.
- **Scorecard**, one number each: auto-parse rate (continuity ✓ with no code change), % rows classified without a human, minutes per
  client-month from first upload to lock, % of report figures that drill to a source row, AI classification precision against a hand-labelled golden set.
- **Five shadow sessions** with accountants closing a real month. Learn which banks, which reports, and what they do in WhatsApp and Excel around us.
- **Verify the competitor gaps** in §7 on live trial accounts.

Exit: a scorecard page in `docs/` with today's numbers. Every later iteration states which number it moves.

### Iteration 1: Universal intake (L, the biggest bet)

Goal: *any* rekening koran, or the payout report of any channel, becomes a continuity-proven statement without an engineer.

1. **Parser builder (the owner's framing, approved).** From the UI, an accountant uploads one sample of a new bank's statement; Buku
   learns a *recipe* for it and every later file of that layout imports without engineering. Cycle 1 covers vocabulary and format
   variants; structural layouts follow. Mechanism below.
   **Layout fingerprint + recipe.** Fingerprint a file's structure (header text, column positions, date and amount shapes). For an unseen
   fingerprint, one cached LLM call proposes a *recipe* (column mapping, date format, sign convention, row-continuation rule). The
   existing deterministic reader executes it. **The running-balance check accepts or rejects the recipe.** Accepted recipes are stored
   per fingerprint and reused free. Hand-written parsers stay as the fast path and become recipe fixtures. Credit per new layout is bounded.
2. **Scans and photos.** OCR or a vision model produces rows. The same oracle gates them. Rows that break the chain open a review pane
   with the page image crop beside the parsed row. Nothing posts on OCR output the chain has not proven.
3. **Per-row provenance and confidence** shown in Review (repaired, OCR'd, recipe-read, parsed). Today these live only in import notes.
4. **Bank and source coverage.** BNI, CIMB, Permata, BSI, Danamon, OCBC, Jago; corporate exports (KlikBCA Bisnis, Mandiri Kopra, BNI Direct);
   then e-wallets, payment gateways and marketplace payouts as *sources* (gross, fees, net, payout), which is where SME books diverge from the bank.
5. **Intake channels and the missing-list.** Per-client drop address (email), Drive-folder watch (Drive read exists), and a per-client-month
   checklist: which accounts and months are still missing, derived from continuity. Defer WhatsApp until the cost and terms are clear.

Exit: ≥ 95 % of the corpus reads with the chain proven and no code change; a never-seen layout becomes usable in minutes; zero silent wrong numbers (same bar as today, now with AI inside the loop).

**Risk, needs a decision (§6):** sending statement images or full text to an LLM is a bigger disclosure than today's "merchant key and
80 characters". It changes `docs/real-data.md` rules 4–5 and ADR 0003/0009, and UU PDP applies.

### Iteration 2: Reconciliation and rules you can see (M)

- **Rules as an asset.** A readable, editable rule list per client and per firm (Jurnal's Bank Rules, but with hit counts, "would have
  matched N past rows" previews and an owner). Memory and rules become one concept the accountant manages.
- **Matching beyond 1-to-1.** One receipt for many invoices and many payouts for one bank line (the FIFO settle exists; add the
  reverse and the marketplace case); bulk accept with a reason; every match shows why.
- **Calibrated confidence.** Using the Iteration 0 golden set, show measured precision per method (rule, memory, AI). Deterministic
  methods above a threshold may post directly, as invariant 4 already allows; AI-only suggestions still go to review.
- **Review by exception.** The queue is sorted by risk and amount; the accountant approves a batch and opens only the rows that look
  wrong.

Exit: share of rows closed without a human rises from the Iteration 0 baseline; precision per method is on screen.

### Iteration 3: Report packs by audience (L)

Same GL, different readers. A **Pack** is a named, versioned bundle:

| Pack | Reader | Contents (first cut) |
|---|---|---|
| **Paket Bank** | credit officer | SAK-labelled statements, CALK, 12-month cash view, debt schedule, aging, key ratios, statement-balance reconciliation |
| **Paket Investor** | investor or board | Monthly management report, KPIs, variance vs last month and year, runway, AI-drafted commentary with citations |
| **Paket Pajak** | KPP or tax adviser | Koreksi fiskal (exists), **Coretax SPT Badan Lampiran 1 mapping** by sector, PPh schedules, export for the client's PJAP |
| **Paket Audit / PBC** | external auditor | TB grouped to FS lines, lead schedules, supporting-document index, adjustment log |
| **Ringkasan Pemilik** | the SME owner | One page in plain Bahasa |

Plus: firm letterhead and per-client format (exists), **"issued" snapshots**: a pack is frozen with a hash and a date, so a figure
sent to a bank is reproducible and a later correction produces a visible new version. Commentary is drafted by AI, cites the accounts
and rows it used, and is edited by the accountant before issue. Check the applicable compilation-engagement report wording with the
firm's IAPI guidance before shipping it (unverified here).

Exit: a firm produces a bank-ready and an investor-ready pack for a closed month in under ten minutes, from a closed ledger, without Excel.

### Iteration 4: Interop and exits (M)

Make being the close layer safe for firms whose clients already use Jurnal, Accurate or Zahir.

- **Export the closed GL as an import file** for Jurnal, Accurate and Zahir, so the corrected books go back to the client's system.
- **Read Zahir ledger and TB exports** (Jurnal and Accurate are already read).
- **Tax handoff, not filing:** PPN and PPh summaries in the shape a PJAP (Klikpajak and peers) accepts. Verify the formats first.
- Direct feeds are a *later* channel through a licensed aggregator; they are not on this plan because no usable open-banking path exists today (ADR 0004).

### Iteration 5: The firm cockpit and one AI surface (M–L)

- **Portfolio view:** every client × month × stage (Intake → Review → Close → Pack), who owns it, what blocks it. Beranda is the start of this.
- **Client questions as a first-class loop:** the list for the client (`lib/review-questions.ts`) becomes a shareable request with replies
  that resolve review lines.
- **One assistant, one proposal inbox.** Replace scattered buttons with a single queue of proposals (a classification, a recipe, a draft
  entry, a commentary paragraph), each with its evidence and an approve/reject. Tanya Buku answers from the same data.
- **Prepare-the-close run:** one action runs the checklist, drafts proposals, and stops at the approval gate. It never posts or locks.
- **Pricing experiment:** per client-month (maps to the firm's own billing) rather than per seat. A hypothesis to test, not a decision.

## 5. Radical moves behind the plan

1. **Re-centre the information architecture on the pipeline.** Four lanes per client-month: *Masuk* (intake), *Review*, *Tutup*, *Paket*.
   Assets, leases, benefits, inventory, tax and subledgers move under *Tutup* as "schedules" you open when a control asks. The menu
   stops looking like an ERP.
2. **Freeze new accounting modules.** No new PSAK schedule, invoicing, POS, payroll, inventory flows or e-Faktur filing until
   Iterations 1 and 3 land. Bugs and corrections still ship.
3. **Recipes over per-bank code** for new layouts, with the oracle as gatekeeper (Iteration 1).
4. **Issued reports are immutable objects** (Iteration 3). The GL stays the only source of figures; a pack is a frozen view of it.
5. **Explicit non-goals:** chat as the headline AI feature (Zahir has one); autonomous posting (invariant 4, and firms need traceability
   where US tools sell autonomy); competing on filing rails or bundles we cannot match.

## 6. Decisions

Answered 2026-10-06:

- **D1 approved:** layout and header only go to a model, never counterparty names, account numbers or amounts (digits and letters masked).
  Scans use OCR on our side later.
- **D2:** the big Indonesian banks first, and a **parser builder** so new banks need no feature work (now the lead of Iteration 1).
- **D3:** bank pack first in Iteration 3.
- **D4 open:** asked what it means. It is the pause on *new accounting modules*, see radical move 2. Default stays "yes" unless a pilot objects.

Original table, kept for the reasoning:

## 6a. Risks and decisions needed

| # | Question | Why it matters | Default if not answered |
|---|---|---|---|
| D1 | **May full statements or page images go to an LLM provider?** Options: (a) hosted provider with a zero-retention agreement, (b) redaction of account numbers and names before the call, (c) OCR on our own infrastructure and the LLM sees layout only. | Iteration 1 is blocked on it. Client NDAs and UU PDP. | (c)+(b): layout and header text only, never counterparty names. |
| D2 | Which banks and sources do the pilot firm(s) actually receive? | Orders Iteration 1 item 4. | The list in §4. |
| D3 | Which pack first: bank or investor? | Orders Iteration 3. | Bank (matches the "SAK-standard" lending need). |
| D4 | Is a pause on new accounting modules acceptable to the pilot firms? | Radical move 2. | Yes, unless a pilot names a blocker. |
| D5 | Is the IA re-centring worth a release of visible change before Iteration 1 ships? | Radical move 1. | Ship it with Iteration 2 so intake and review land in the new lanes together. |

Other risks: LLM cost on long-tail layouts (mitigated by caching recipes per fingerprint and the existing budget guards); OCR on poor
photos (mitigated because the oracle refuses unproven rows); regulatory wording for compilation reports and Coretax lampiran changes
(verify with current IAPI and DJP material); competitor catching up on statement AI (Jurnal has OCR and an OpenAI-based assistant
already).

## 7. To verify by hand (research gaps)

- Live Jurnal and Zahir pricing, tiers and user limits; which banks Jurnal Direct Feeds covers today.
- Whether Zahir or Jurnal parse PDF statements anywhere; what Jurnal's bank-rule engine can express.
- Zahir fixed-asset, multi-currency and consolidation depth; whether it exports to e-Faktur/Coretax.
- Accurate's accountant-partner programme and any AI features; Smartlink's real bank list.
- Whether SAK EMKM was formally retired or merged into SAK EP (sources conflicted).
- Any lender-specific financial-pack requirements (OJK or bank templates).
- Review text from Capterra, G2, Google Play, Kompasiana (not readable in the research session).

## 8. Source list (all search-level, none read directly)

Zahir: zahiraccounting.com product and pricing pages; Selular 2015 and 2017; CNN Indonesia 2015; Republika 2018; Kontan and Bisnis.com
on Zahir AI (Sept 2024); Capterra ZahirERP; Mekari community comparison; Thrive comparison.
Jurnal / market: jurnal.id Cash Link, help-center import article, features and pricing pages; mekari.com finance-division and Stream/JPN
pages; klikpajak.id Jurnal integration; Jurnal blogs on multi-currency, fixed assets, Airene; Accurate help-centre Smartlink and bulk
reconciliation pages; Kledo FAQ; Xero reconcile page; Rillet, Digits, Pilot, Basis, Numeric product and press pages; DDTC on SAK EP;
MUC and Pajakku on Coretax SPT Badan lampiran; pajak.com and bee.id on KUR and SAK EMKM.

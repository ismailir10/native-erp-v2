# 0014 — Three stages: Sumber → Buku Besar → Laporan (2026-10-06)

**Context.** Market feedback pointed at Zahir, Jurnal (Mekari) and Accurate as software that serves Indonesian customers well, and it
asked Buku to be strong at three things, in order, with AI assisting each of them:
1. getting source files ready and parsing them well;
2. a robust general ledger;
3. the typical Indonesian reports for any reader: tax, SAK, bank, investor.

A competitor study (web-search summaries, October 2026) found the following:
- The incumbents serve the **business owner**, who records transactions. Their bank feeds need the owner's e-banking login, and they
  don't read PDF rekening koran.
- They price per company and sell tax through PJAP partners.
- Their AI (Airene, Ailita, Zahir AI) narrates reports after the fact. None of it classifies or proposes entries during the close.
- None of them offers a close board across many clients.

Buku's ledger core holds up (QA 2 October: every recomputed figure matched to the rupiah). Its weakness is the input edges and breadth:
72 cycles in 11 days, at least 16 of them fix rounds, and about 20 pages per client.

The plan was challenged by an independent review before the owner approved it. The approved plan deck is
[`docs/plan/2026-10-rencana-iterasi.html`](../plan/2026-10-rencana-iterasi.html) (self-contained; open the file). Its review is in
`docs/cycles/2026-10-06-plan-deck.md`.

**Decision.**
1. **Thesis.** Buku is where an accounting firm closes a client's books from whatever the client sends, and every number proves itself.
   It coexists with Zahir, Jurnal and Accurate (their exports are one of its sources) and does not try to replace them as the client's
   day-to-day tool.
2. **One spine per client per month: Sumber → Buku Besar → Laporan**, plus one firm-level close board.
   - *Sumber* is files in, complete and proven.
   - *Buku Besar* is review, reconciliation per bank account per month, adjustments and the close.
   - *Laporan* is packs per reader from one account-to-line mapping.
   - The PSAK modules (leases, employee benefits, CKPN, inventory, assets) become per-client toggles under *Penyesuaian*.
3. **One AI pattern everywhere: AI mengusulkan, aritmetika membuktikan, akuntan menyetujui.** AI sorts, extracts, classifies and drafts
   commentary. Deterministic checks (the running-balance chain, controls) decide what holds. Only the accountant posts, locks and sends.
   This restates ADR 0003 and ADR 0009 as the product's organising rule; it changes neither.
4. **Iteration order** (each about 1–2 weeks; the failures of I0 set the exact scope of I1 and I2):
   - **I0 — Bukti dulu.** One real client, one real month, one accountant, timed end to end. Alongside it, the database guards on the
     ledger and per-file date order.
   - **I1 — Sumber: kotak masuk & kelengkapan.**
     - One upload inbox plus a client upload link that needs no account.
     - AI sorts files by type, bank, account and period, then the deterministic parsers read them.
     - A completeness grid of accounts × months.
     - A Bahasa request-for-data message.
     - The new navigation.
   - **I2 — Sumber: OCR with proof.**
     - A vision model reads scans and photos, and a row is accepted only when the running balance ties on that row.
     - The model never sees the expected balances.
     - Files with no balance column go to line-by-line review.
     - Tests use recorded extractions.
     - A per-firm AI switch and redaction (UU PDP).
     - Banks are added when a real client's file arrives.
   - **I3 — Buku Besar you can trust.**
     - A keyboard-first review queue with confidence bands.
     - Reconciliation status per bank account and month.
     - Closing entries and owner books.
     - The further controls that the real month shows are missing.
   - **I4 — Report engine and packs.** One account-to-line mapping drives every layout. Packs in this order:
     1. Pajak (PPh Badan, rekonsiliasi fiskal, SPT 1771 attachments). It is called a tax pack only once PPh 21 TER and Unifikasi are
        in scope.
     2. SAK EMKM / SAK EP. SAK ETAP is not offered; SAK EP replaced it in 2025.
     3. Paket Kredit Bank: statements, agings, asset list, bank receipts vs revenue, and a source-trace appendix. Ratios get one page.
     4. Management monthly. The investor pack is deferred.
   - **I5 — AI layer and firm board.**
     - AI commentary that may cite only computed numbers.
     - Anomalies inside the controls.
     - The close board across clients.
     - Coretax faktur and bukti potong imports reconciled to PPN and PPh, as an integration project of its own.
5. **North-star metric:** the time from client files received to a pack ready to send, measured first in I0. Three companion metrics:
   - the share of rows posted with proof and no manual touch;
   - Temuan that reached a sent report (target zero);
   - the share of cycles that are fix rounds.
6. **Defaults the owner approved** (2026-10-06):
   - the buyer is the accounting firm, and SMEs are reached through firms;
   - PSAK modules become per-client toggles in I1;
   - no new modules until I2 is done.

**Not doing** (until a decision reverses it):
- exporting adjusted journals back into Accurate or Jurnal (the import direction exists);
- marketplace settlements (Shopee, Tokopedia): a separate product;
- live bank feeds: the statement stays the integration (ADR 0004);
- becoming a PJAP: Buku prepares files and a partner submits them;
- new PSAK modules before I2.

**Consequences.**
- Each iteration's cycle doc names the stage it serves.
- Work outside the spine needs a reason in its spec.
- ADR 0004's out-of-MVP list is stale (AR/AP, FX, auth and PDF extraction exist). Its remaining exclusions are restated here.
- The public `/deck` (`public/deck`) shows only what Buku does today. Plan material stays in `docs/`, because everything under
  `public/deck` is served without login.

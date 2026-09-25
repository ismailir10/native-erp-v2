# Buku workspace review prototype

Open [buku-workspace.html](buku-workspace.html) in a browser. It is a single, offline HTML file with inline styles, scripts, and icons; no build, dependencies, database, storage, or API access. Alternatively, from the repository root (serve only documentation):

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs
```

Then open `http://127.0.0.1:4173/prototypes/buku-workspace.html`.

## Review journey

1. Sign in with **akuntan@buku.example**, then code **123456**. This sends no email and provides no real security.
2. On **Beranda**, ask “Klien mana yang belum siap tutup buku?” Open the cited bank statement.
3. Change scope from **Semua klien** to **Grup Nusa** to **PT Nusa Niaga**. Each view uses the same period; old answers preserve their original scope and values under **Riwayat pertanyaan**.
4. Ask “Bandingkan laba laporan dengan buku”. Source-reported profit is Rp 35,600,000; books show Rp 38,000,000 because Rp 2,400,000 remains in suspense.
5. Open **Pekerjaan → Periksa transaksi**. Inspect source, then approve classification. Buku adds a balanced reclassification entry and preserves the original bank entry.
6. Click a report amount to see only its contributing journals, then inspect their sources and return to the same report. Follow **Buku Besar → Laporan → Tutup buku**. Profit is now Rp 35,600,000; cash remains Rp 135,600,000. Confirm the sign-off to close the period.
7. Open **Dokumen**. Filter among bank statements, imported ledgers, financial statements, company profiles, and supporting documents. Every category has a source preview.
8. Inspect **Juli 2026** (closed) and **September 2026** (no data). Empty data never claims a zero balance or a ready close.
9. Resize to 390px and use keyboard navigation, including Escape to close source and answer panels.

**Mulai ulang** clears in-memory review, close, and question state and returns to simulated login. Reloading also clears that state; scope, period, and current page remain in the URL. No credentials or source data are stored.

## Design and accounting boundaries

- Three invented companies, two clients, IDR only. August and July datasets are independent scenario fixtures, not a continuous set of real monthly books.
- All journals balance. Financial amounts use `bigint`; every financial value shown in reports comes from the equivalent synthetic journal scenario.
- Uploaded report figures are independent source evidence. Opening-ledger imports and company profiles have distinct purposes and labels.
- The assistant supports four scripted topics: close readiness, profit comparison, bank balances, and company activities. Unsupported prompts explicitly say they are unavailable.
- All-clients and group views compare companies; they do not claim statutory consolidation.
- No upload, real invitation, external integration, or production authentication is implemented. No roles: all simulated users see the shared workspace.
- The simplified close checklist illustrates the proposed interaction; it does not replace production accounting controls.

Product architecture: [editable SVG](../architecture/buku-architecture.svg). Implementation context: [cycle](../cycles/2026-09-25-architecture-prototype.md).

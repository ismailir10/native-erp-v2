# Accountant hard test — the fixes a reviewing Indonesian accountant asks for first

## Context
On 2026-09-30 the user asked for a hard test "as an Indonesian accountant" of usability and accounting quality, then spec → build → ship →
merge without further check-ins ("i expect you to do big improvement towards the usability, just get them done"). Four test passes ran
locally against the demo firm and four fresh clients (onboarding + import; financial statements; adjustments + tax; daily work + close).
Their findings, confirmed against the code, that this cycle fixes:

1. **HPP is just purchases.** Trading clients (CV Sinar Retail, PT Ayam) expense 5100 purchases as cost of sales and 1160 Persediaan never
   moves: no persediaan awal + pembelian − persediaan akhir, no stock count. The close lets it lock. The biggest accounting gap.
2. **Close notes never go stale, reopening keeps the sign-offs.** A 5-character note written when 2 lines were in review still clears the
   control when 200 are; after *Buka kembali* the three ticks stay, so the month closes again in one click without a new review.
3. **Review makes blind guesses one keystroke away and learns them.** In rules-only mode every payment is prefilled *6190 Beban umum* and every
   receipt *4100 Penjualan*; Enter posts it and Memory then auto-posts that merchant on the next import. The *PPh 21 / PPh 23 / PPh 4(2)*
   options sit next to *PPN Masukan (pisah 11%)* but only tag a remittance — they book no withholding, so a service payment net of PPh 23 posts
   net. No search, filter or bulk accept for a 30-line queue.
4. **Tax payments as banks print them are guessed as expenses.** "MPN G2", "DJP ONLINE SSP 411121-100", "BAYAR PAJAK KPP" → 6190. A client
   rule "PAJAK" overrides the firm's more specific "PAJAK BUNGA" and auto-posts interest tax to PPN Keluaran. Under PP 55/2022 the 0,5 %
   final tax is never expensed (the pack proposes no journal) and the pack says a PT may use it for 4 years (PP 55/2022 Pasal 59: PT 3).
5. **Reports don't say what they are.** An open month with lines still in review, money in 1999 and a missing statement shows green
   *Seimbang* pills with no *Draf* marker; comparative columns full of "–" when there is no prior year; "1 Januari – …" when the books start
   in March; *Beban lain-lain* in parentheses while other expenses are positive; the CALK shows PPh kini that the Laba Rugi doesn't carry.
6. **Smaller day-one blockers.** A statement from the wrong year, imported before an account's first statement, is accepted, drives Saldo
   Awal and can't be undone. Transfers written "TRF" are never paired. Beranda ranks "Periksa n transaksi" above missing statements and
   failed controls and shows *Belum ada jurnal* before *Kontrol gagal*. A manual journal can't be reversed. Jurnal Penyesuaian hides under
   *Pengaturan klien*; its locked-month banner is green. Saldo Awal plugs any difference into 3200 without showing it.

## Spec
- [ ] **S1 Persediaan & HPP (stock opname), periodic method.** New page *Persediaan* per client (menu, month-end group): per entity with
      inventory (a 1160 balance, HPP movement, or *Bidang usaha* reading as trading), the book balance of Persediaan at the month end, the
      counted value typed by the accountant (`parseMinor`), the difference, and *Catat persediaan akhir* → one `ADJUSTMENT` via
      `postJournal()` dated the month end: increase Dr 1160 / Cr **5190 Perubahan Persediaan** (HPP line, template account created on first
      use), decrease the reverse; a count equal to the book records no journal. Stored as `InventoryCount` (entity, year, month, counted
      amount, entry id or null, note, who) — one per entity-month, refused in a locked month, re-countable (a new count books the difference
      from the GL balance, never re-books). Laba Rugi shows 5190 inside Beban pokok pendapatan; the CALK adds a *Beban pokok penjualan* note:
      persediaan awal + pembelian (HPP accounts except 5190) − persediaan akhir. Close control `inv:<entity>` (REVIEW, never FAIL) when an entity
      with inventory has no count for the month ("stock opname hanya akhir tahun" is a valid note). Deleting a client deletes its counts.
- [ ] **S2 Close notes and reopening.** A control note stores the control's detail at the time of the note; when the detail changes the note
      no longer clears the control (shown "Catatan lama: …, kondisinya berubah"). Legacy notes (no stored detail) keep working. Reopening a
      month removes its sign-offs in the same transaction as the unlock log.
- [ ] **S3 Review safety and speed.**
      - A *Tebakan* (HEURISTIC, no counterparty rule/memory/AI behind it) is not accepted by Enter: Enter moves focus to its account picker
        and says so; the button still accepts. Accepting a guess unchanged never writes Memory.
      - Tax options say what they do: *Setoran PPh 21 / 23 / 4(2)*, *Angsuran PPh 25* (a remittance), PPN split unchanged; plus a
        **withholding** option *Dipotong PPh 23 / 4(2) / 21 / 22* with a rate (defaults 2 / 10 / 5 / 1,5 %): the bank amount is the net, the tax
        = gross − net with gross = net ÷ (1 − rate) (half up), booked through `reviewTransaction({ withholding })` (rule 5h) — shown as
        "Bruto Rp X · PPh 23 Rp Y" before accepting.
      - A search box (description / amount), filters *Semua · Uang masuk · Uang keluar · Tebakan*, and *Terima semua usulan yakin (N)* for
        the visible AI/memory suggestions with confidence ≥ 80 %.
- [ ] **S4 Tax payments and rules.** Firm rules for tax payments as banks print them, by KAP/KJS code: 411121 → 2140 PPh 21, 411124 → 2141
      PPh 23, 411128 → 2145 PPh final, 411125-100 → 1180 PPh 25, 411125-200 → 2146 PPh 29, 411211 → 2130 PPN (data migration for existing
      firms, like `20260930050000_tax_payment_rules`). A payment reading as a tax payment without a code (MPN, DJP, SSP, "PAJAK", billing
      code) gets a review suggestion 2145 *Utang Pajak Lainnya* with the reason "setoran pajak — pilih utang pajaknya", never an expense.
      Rule order: a firm rule whose pattern contains a matching client rule's pattern (strictly more specific) wins over it.
- [ ] **S5 PP 55/2022 final tax.** Under the final regime the pack proposes a journal like the current-tax one: Dr 8200 / Cr 2145 for 0,5 % of
      year-to-date turnover, the difference from earlier postings of that kind; remittances already file to 2145. Text: PT 3 tahun pajak,
      CV/firma/koperasi 4 (PP 55/2022 Pasal 59).
- [ ] **S6 Reports say what they are.** A status line on Laporan Keuangan (and a *DRAF* mark in the Excel title rows) — *Final — ditutup
      oleh X, tanggal* or *Draf* with what makes it one: n transactions in review, Belum Terklasifikasi (1999) balance, missing statements,
      due unposted schedules, month open. Comparative columns (last month / 31 December / same months last year) are shown only when those
      dates hold entries; the YTD label starts at the books' start when the Saldo Awal falls in the year ("1 Maret – 31 Agustus 2026").
      Expenses under *Pendapatan (beban) lain-lain* are positive like other expenses with a *Jumlah* line; "(Dinyatakan dalam Rupiah)" /
      the currency under each statement title. The CALK tax note says when the PPh kini isn't journaled yet.
- [ ] **S7 Import guard and transfer pairing.** A statement for an account that already has statements, ending before the earliest one, is
      refused when its closing balance differs from that statement's opening, with a message naming both dates and balances ("periksa tahun dan
      rekeningnya"). "TRF" counts as a transfer hint.
- [ ] **S8 Beranda and navigation.** Client status checks FAIL before *Belum ada jurnal*; missing statements and failed controls rank as
      high-priority tasks ahead of review; a review task names the client when the entity name differs. *Jurnal Penyesuaian* and *Persediaan*
      sit in the main client menu (month-end, before Tutup Buku). The journal form in a locked month is disabled under a warning (not green)
      saying how to reopen.
- [ ] **S9 Reverse a manual journal.** The entry dialog of a manual `ADJUSTMENT` (no schedule, register or pack behind it) offers *Balik
      jurnal*: a new `ADJUSTMENT` with every line mirrored, dated by the accountant (default the 1st of the next month), memo "Pembalik: …",
      refused in a locked month and when already reversed (stored `reversesId`).
- [ ] **S10 Saldo Awal shows its plug.** Totals of debit and credit and the difference that goes to 3200 Saldo Laba, live, before saving.
- [ ] **S11 Docs + tests.** DB tests for S1, S2, S4, S5, S7, S9; unit tests for the gross-up, rule order and hints; e2e for the Persediaan page
      and review filters; accounting-rules, README and ui-rules rows; full gate incl. `verify:books`.

**Gate reopeners (approved up front by the user's "just get them done"):** schema migration (InventoryCount, ControlAck.detail,
JournalEntry.reversesId; data migration for firm rules); accounting invariants **extended** — rule 13 (firm rule more specific than a client
rule wins), new rules 5i (inventory) and 3a (reversal). No new dependency, no AI calls.

**Non-goals:** perpetual inventory / item-level stock; PPh 21 TER payroll; WAPU and DPP Nilai Lain on invoices; splitting one bank line over
several accounts (loan principal + interest); undoing an import; Tanya Buku parsing client names; staff assignment; Excel formulas and
print styles; a fuller CALK (akta, pihak berelasi); PPh 23 at accrual instead of settlement.

**Assumptions / decisions made without asking:**
1. Stock count is **periodic** and optional per month: firms that count only in December ack the REVIEW with a note.
2. The HPP breakdown goes in the CALK note, not as extra rows on the face of the Laba Rugi (the face shows 5100 and 5190 as accounts).
3. Withholding in Review uses a gross-up from the net bank amount; the amount stays editable later in the ledger drawer (existing).
4. The import guard only refuses the clearly wrong case (before the first statement and not connecting); files after the last one keep the
   existing gap check.
5. A reversal is offered only for manual adjustments; schedule, register, pack and bank entries have their own ways to change.

## Tasks
- [ ] T1 S2 close notes + reopen — accept: DB test: note lapses on changed detail, legacy note holds, unlock clears sign-offs.
- [ ] T2 S1 domain: `InventoryCount`, `lib/inventory`, control, CALK note, client delete — accept: DB test for increase/decrease/equal/locked/recount.
- [ ] T3 S1 UI: *Persediaan* page + menu — accept: record a count in the browser, Laba Rugi shows 5190, control passes.
- [ ] T4 S4 tax rules + migration + tax-payment suggestion + rule specificity — accept: unit + DB tests.
- [ ] T5 S5 PP 55 journal + text — accept: DB test posts 0,5 % difference once.
- [ ] T6 S3 review: tax labels, withholding with gross-up, guess safety, search/filter/bulk — accept: unit test for gross-up, DB test for no-learn, e2e filter.
- [ ] T7 S6 reports status, comparatives, labels, signs, Excel draft mark — accept: page shows *Draf* with reasons; no empty columns.
- [ ] T8 S7 import guard + TRF — accept: DB test refuses the wrong-year file; unit test pairs TRF.
- [ ] T9 S8 Beranda, menu, locked journal form — accept: unit/DB test for ordering; screenshot.
- [ ] T10 S9 reverse manual journal — accept: DB test (mirror, once, locked refused).
- [ ] T11 S10 Saldo Awal totals — accept: screenshot.
- [ ] T12 S11 docs + full gate.

## Implementation
## Verification
## Ship Notes

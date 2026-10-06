# The real month (I0)

[ADR 0014](adrs/0014-three-stage-spine.md) starts the plan with proof: one real client, one real month, one accountant, timed from the
files arriving to the report being sent. This page is how to run it. What fails here sets the scope of I1 (Sumber: inbox and
completeness) and I2 (OCR with proof). Anything that doesn't block this month waits.

Read [real-data.md](real-data.md) first. Its rules on where real files may live hold here too.

## 1. Pick the client
- **One firm client the accountant closes every month anyway**, so the timing compares with how long it takes today. Write that
  number down before starting (for example "usually 2 days").
- **The ugliest file set you can get.** It should hold at least one of each of these, if the client has them:
  - a bank the parsers know (BCA, Mandiri, BRI) as a PDF e-statement;
  - a statement that is a scan or a phone photo (BRI passbook, m-banking screenshot);
  - an Excel the client's admin made;
  - a ledger or Neraca export from Jurnal, Accurate or Zahir, if the client keeps one.
- **One accountant from the firm**, not the developer. The developer watches and writes things down but doesn't touch the keyboard.

## 2. Data protection (UU PDP)
- **AI stays off for the real month unless the firm decides otherwise in writing.** Leave the key empty in Pengaturan (admin only) and
  unset `AI_API_KEY`. Buku then runs on rules only and is fully working ([real-data.md](real-data.md) rule 4 lists what an AI call
  would send).
- Files stay in `data/private/` locally, or in the production workspace. They are never committed, never shared in a chat, and never
  shown in a screenshot outside the firm.

## 3. Run the month
1. **Start the clock** when the client's files reach the firm, not when the first upload happens. Write that time down; Buku can't
   see it.
2. Follow the app:
   - **Tambah klien**: the client and its entities;
   - **Unggah data**: every file, the scan and the photo included, even though they will be refused today;
   - **Saldo Awal**;
   - **Review**;
   - **Tutup buku**;
   - **Laporan**: download the statements (Excel or PDF) and, for a PT, the PPh Badan workpaper.
3. **Log every blocker as it happens**, in `data/private/reports/real-month-<client>-<yyyy-mm>.md` (gitignored). Use one line per
   blocker:

   | Time | Step | What happened (Buku's message verbatim) | Workaround | Minutes lost | Stage |
   |---|---|---|---|---|---|

   *Stage* is Sumber, Buku Besar or Laporan (ADR 0014), so the list sorts straight into I1–I4.
4. **The month ends** when the accountant downloads the first report after **Tutup buku**.

## 4. Read the timeline
```bash
npm run close:timeline -- --client "<client name>" --period 2026-09
```
The output shows:
- **file pertama / file terakhir**: the first and last import;
- **tinjau terakhir**: the last review action;
- **dikunci**: when the month was locked;
- **terkirim pertama**: the first report downloaded after the lock, which is logged as *Laporan diunduh* in Riwayat perubahan;
- **file → kunci** and **file → terkirim**: the elapsed times.

The north-star number is the time from when the files reached the firm (the time you wrote down) to *terkirim pertama*. *File → terkirim*
is the part Buku can see. The difference is time spent collecting and converting files before Buku took them, which is what I1 is for.

## 5. Turn it into scope
- Sort the blocker log by minutes lost.
- Everything in **Sumber** becomes I1's tasks (inbox, completeness, client upload link) or I2's (scans, photos, new banks), in that
  order.
- Anything in **Buku Besar** or **Laporan** that cost more than 30 minutes becomes a candidate for I3 or I4. A smaller one becomes a
  line in the next cycle doc's Context.
- Record the result in the I1 cycle doc's Context:
  - the baseline time;
  - Buku's time;
  - the top five blockers.
- Run the month again after I2, with the same client and the same accountant.

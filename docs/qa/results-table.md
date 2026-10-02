# Per-case results

Generated from [results.json](./results.json) (the 165 checks of the original run plus the VF-* re-verifications after the fixes). ✅ pass · ❌ fail (a bug, see [bugs/](./bugs/README.md)) · ℹ️ observation · ⏭ skipped.

## A

| Case | Result | Detail | Evidence |
|---|---|---|---|
| A01 | ✅ PASS | Login page shows heading + forgot link | [img](./screenshots/A01-login.jpg) |
| A02 | ✅ PASS | Empty submit is stopped by native browser validation (required fields); bubble language follows the browser UI, not the app. Not a defect. | [img](./screenshots/A02-login-empty.jpg) |
| A03 | ✅ PASS | Wrong password message | [img](./screenshots/A03-login-wrong-password.jpg) |
| A04 | ✅ PASS | Unknown email -> same generic message (no enumeration) |  |
| A05 | ✅ PASS | XSS payload in login email is inert |  |
| A06 | ✅ PASS | Reset notice identical for member / non-member | [img](./screenshots/A06-forgot-member.jpg) |
| A07 | ✅ PASS | Valid login lands on Beranda | [img](./screenshots/A07-after-login.jpg) |
| A08 | ✅ PASS | Session persists across reload |  |
| A09 | ✅ PASS | Signed-in user visiting /login is redirected: http://localhost:3300/?scope=all&period=2026-08 |  |
| A10 | ✅ PASS | Keluar returns to /login |  |
| A11 | ✅ PASS | Back/reload after logout does not expose the workspace: http://localhost:3300/login | [img](./screenshots/A11-back-after-logout.jpg) |
| A12a | ✅ PASS | Firm B Beranda lists none of firm A's clients | [img](./screenshots/A12-firmB-beranda.jpg) |
| A12b | ✅ PASS | All 17 client routes of firm A are 404 for firm B | [img](./screenshots/A12-firmB-cross-tenant-404.jpg) |
| A12c | ✅ PASS | Cross-tenant Excel exports: reports=404 tax=404 |  |
| A12d | ⏭ SKIP | No evidence intake seeded |  |
| A12e | ✅ PASS | scope=client:<firm A id> rejected for firm B (Cakupan tidak tersedia) | [img](./screenshots/A12-firmB-forged-scope.jpg) |
| A13a | ✅ PASS | AKUNTAN sees read-only notice on /settings | [img](./screenshots/A13-akuntan-settings.jpg) |
| A13b | ✅ PASS | AKUNTAN does not see 'Hapus klien' card | [img](./screenshots/A13-akuntan-client-settings.jpg) |
| A14 | ✅ PASS | Disabled member is bounced on next request: http://localhost:3300/login | [img](./screenshots/A14-revoked-live-session.jpg) |

## C

| Case | Result | Detail | Evidence |
|---|---|---|---|
| C01 | ✅ PASS | Empty save blocked: Isi nama klien. \| Isi nama badan usaha. \|  | [img](./screenshots/C01-empty-save.jpg) |
| C02 | ✅ PASS | Whitespace-only client name rejected |  |
| C03 | ✅ PASS | Client name of 121 chars rejected: Nama klien maksimal 120 karakter. \|  |  |
| C04a | ✅ PASS | NPWP "123" -> rejected (NPWP berisi 15 atau 16 angka, boleh dengan titik dan strip. \| ); expected reject | [img](./screenshots/C04a-npwp.jpg) |
| C04b | ✅ PASS | NPWP "ABCDEFGHIJKLMNO" -> rejected (NPWP berisi 15 atau 16 angka, boleh dengan titik dan strip. \| ); expected reject | [img](./screenshots/C04b-npwp.jpg) |
| C04c | ❌ FAIL | NPWP "1234567890123456789" -> accepted; expected reject | [img](./screenshots/C04c-npwp.jpg) |
| C04d | ✅ PASS | NPWP "01.234.567.8-015.000" -> accepted; expected accept | [img](./screenshots/C04d-npwp.jpg) |
| C04e | ✅ PASS | NPWP "0123456789012345" -> accepted; expected accept | [img](./screenshots/C04e-npwp.jpg) |
| C05a | ✅ PASS | Account number "123" -> rejected (Nomor rekening berisi 6–20 angka. \| ) | [img](./screenshots/C05a-acct.jpg) |
| C05b | ✅ PASS | Account number "ABC1234567" -> rejected (Nomor rekening berisi 6–20 angka. \| ) | [img](./screenshots/C05b-acct.jpg) |
| C05c | ✅ PASS | Account number "111111111111111111111" -> rejected (Nomor rekening berisi 6–20 angka. \| ) | [img](./screenshots/C05c-acct.jpg) |
| C05d | ✅ PASS | Account number "1234 5678 90" -> accepted | [img](./screenshots/C05d-acct.jpg) |
| C06 | ✅ PASS | Duplicate account number within form rejected | [img](./screenshots/C06-dup-in-form.jpg) |
| C07 | ✅ PASS | Same account number allowed in a different firm (no cross-tenant leak) | [img](./screenshots/C07-cross-firm-account.jpg) |
| C08 | ✅ PASS | HTML in client/entity name rendered inert (dialogs=0, injected imgs=0) | [img](./screenshots/C08-xss-name.jpg) |
| C09a | ✅ PASS | Client created in the right firm; landed on /clients/cmuqbp8ds00ccb87dm8f7lk1b/import | [img](./screenshots/C09-after-create.jpg) |
| C09b | ✅ PASS | Entity [{"name":"PT Bintang Mulia Sejahtera","kind":"PT","fw":"SAK_EP"}]; COA accounts=71; bank GL=[{"number":"0012345678","code":"1101","name":"BCA Giro Utama (PT Bintang)"}] |  |
| C09c | ✅ PASS | First bank account gets GL 1101 (got 1101 BCA Giro Utama (PT Bintang)) |  |

## E

| Case | Result | Detail | Evidence |
|---|---|---|---|
| E01 | ✅ PASS | F1 (5 rows incl. two identical same-day BIAYA ADM): +5 rows, net movement 22220000 (expected 22,220,000 inflow-outflow = -22,220,000? computed below). toast=5 transaksi diproses | [img](./screenshots/E01-import-F1.jpg) |
| E01b | ✅ PASS | Sum of imported signed amounts = 22220000, expected 22220000 |  |
| E01c | ✅ PASS | Identical same-day rows both kept (BIAYA ADM x2); a dedupe that collapses them would lose Rp 15.000 of bank fees |  |
| E02 | ✅ PASS | Re-upload adds no rows (rows 5->5); toast/page: 0 transaksi diproses | [img](./screenshots/E02-reupload-F1.jpg) |
| E04 | ✅ PASS | Overlapping file adds only the 2 new rows (+2); identical rows not double counted | [img](./screenshots/E04-overlap.jpg) |
| E05 | ✅ PASS | Wrong account number refused: Nomor rekening di file (9999999999) berbeda dengan rekening terpilih (7001002003). | [img](./screenshots/E05-wrong-account.jpg) |
| E06 | ✅ PASS | Broken running balance flagged (continuityOk=false); page: Saldo berjalan dicek di setiap baris. Kalau ada baris yang hilang, hasilnya ditandai Ada celah. | [img](./screenshots/E06-continuity-gap.jpg) |
| E07a | ✅ PASS | F7a-empty.csv: no rows written, friendly error: "Pilih file rekening koran (PDF, CSV, XLS, atau XLSX)." | [img](./screenshots/E07a-F7a-empty.csv.jpg) |
| E07b | ✅ PASS | F7b-header-only.csv: no rows written, friendly error: "File tidak berisi transaksi" | [img](./screenshots/E07b-F7b-header-only.csv.jpg) |
| E07c | ✅ PASS | F7c-binary.csv: no rows written, friendly error: "Kolom tanggal & keterangan tidak ditemukan. Pastikan baris judul kolom ada." | [img](./screenshots/E07c-F7c-binary.csv.jpg) |
| E08 | ❌ FAIL | 7.6 MB upload → HTTP 413 'Body exceeded 6mb limit' → whole page replaced by English 'This page couldn't load' (files 5–6 MB get the friendly message) | [img](./screenshots/E08-oversize.jpg) |
| E08-5.5 | ✅ PASS | 5.5 MB upload -> "File terlalu besar (maks. 5 MB)." | [img](./screenshots/E08-5.5MB.jpg) |
| E08-5.9 | ✅ PASS | 5.9 MB upload -> "File terlalu besar (maks. 5 MB)." | [img](./screenshots/E08-5.9MB.jpg) |
| E09 | ✅ PASS | Indonesian format "1.234.567,00" parsed: ["1234567","-1000","99999999"] (expected 1234567, -1000, 99999999); page: 3 transaksi diproses | [img](./screenshots/E09-generic-id-format.jpg) |
| E12 | ❌ FAIL | XLSX with ISO date cells (t="d", as written by SheetJS cellDates / many web exporters): stored dates = ["1905-07-18","1905-07-18"] (expected 2026-10-02, 2026-10-05); toast="2 transaksi diproses" | [img](./screenshots/E12-sheetjs-date-cells.jpg) |
| E12b | ✅ PASS | Standard Excel date cells: ["2026-10-02","2026-10-05"] | [img](./screenshots/E12b-standard-excel-dates.jpg) |
| E13 | ✅ PASS | Hostile descriptions (formula =HYPERLINK, <script>, emoji/RTL, 3000 chars, DDE +cmd) imported +4 and rendered inert (dialogs=0); toast=4 transaksi diproses | [img](./screenshots/E13-hostile-descriptions.jpg) [img](./screenshots/E13-hostile-in-review.jpg) |
| E13b | ℹ️ NOTE | Formula-looking description stored verbatim (relevant only if a future export writes it as a cell; current exports are statements/tax workbooks) |  |
| E14 | ❌ FAIL | BEFORE FIX: two identical same-day rows in a statement without a running-balance column → whole import fails (unique index BankTransaction_bankAccountId_hash_key), user sees only "Terjadi kesalahan tak terduga" (reproduced; fixed in this PR, see E14-fixed) | [img](./screenshots/E14-twins-without-balance.jpg) |
| E14-fixed | ✅ PASS | AFTER FIX: statement with two identical same-day rows and no balance column imports 3/3 rows (both BIAYA ADM kept); re-upload adds nothing (3/3) | [img](./screenshots/E14-after-fix-import.jpg) [img](./screenshots/E14-after-fix-reupload.jpg) |
| E15 | ❌ FAIL | Newest-first export (true opening 100,000,000 / closing 103,500,000): stored opening=100500000 closing=101000000 continuityOk=false period=2026-09-01..2026-09-30; page said: Ada celah | [img](./screenshots/E15-newest-first-clean.jpg) |
| E15b | ℹ️ NOTE | Saldo Awal prefilled from the (mis-read) opening balance: Rp 100.500.000 | [img](./screenshots/E15b-opening-prefill-from-desc.jpg) |
| E16 | ❌ FAIL | A single zero-amount row (0,00 debit and credit) makes the WHOLE statement fail with the cryptic internal message "Jurnal minimal dua baris" — nothing imported, no row reference | [img](./screenshots/E16-zero-amount-row.jpg) |
| E17 | ℹ️ NOTE | Ambiguous date 10/02/2026 read as 2026-02-10 (D/M/Y assumed — correct for Indonesian banks, but a US-format file is silently misdated; no warning shown) | [img](./screenshots/E17-us-date-ambiguity.jpg) |
| E18 | ❌ FAIL | A 20-digit amount is not caught by the parser: the import dies at the database (Prisma value out of range for bigint) and the user sees "Terjadi kesalahan tak terduga" | [img](./screenshots/E18-huge-amount.jpg) |

## G

| Case | Result | Detail | Evidence |
|---|---|---|---|
| G1 | ✅ PASS | Prive: ["1999 D7250000 K0","1103 D0 K7250000","1999 D0 K7250000","3300 D7250000 K0"] | [img](./screenshots/G1-after-prive.jpg) |
| G2 | ✅ PASS | Aset tetap w/ PPN masukan 11%: expected DPP 166666667 (1210) + PPN 18333333 (1150); got ["1999 D185000000 K0","1101 D0 K185000000","1999 D0 K185000000","1210 D166666667 K0","1150 D18333333 K0"] | [img](./screenshots/G2-after.jpg) |
| G3 | ✅ PASS | Jasa konsultan, PPh 23 2% + PPN 11%, net 15.000.000: expected DPP≈13761467.89 PPN≈1513761.47 PPh≈275229.36; got {"dpp":"13761468","ppn":"1513761","wht":"275229","bank":"15000000"} lines=["1999 D15000000 K0","1101 D0 K15000000","1999 D0 K15000000","6170 D13761468 K0","1150 D1513761 K0","2141 D0 K275229"] | [img](./screenshots/G3-after.jpg) |
| G3b | ✅ PASS | PPh 23 default rate prefill = "2" (jasa: 2%) |  |
| G4 | ✅ PASS | Penerimaan net PPh23 (1180 prepaid) + PPN keluaran: expected DPP≈55045871.56; got ["1999 D0 K60000000","1102 D60000000 K0","1999 D60000000 K0","4100 D0 K55045871","2130 D0 K6055046","1180 D1100917 K0"] | [img](./screenshots/G4-after.jpg) |
| G5 | ✅ PASS | Queue shrinks by accepted items: 4 -> 0 | [img](./screenshots/G5-queue-after.jpg) |

## I

| Case | Result | Detail | Evidence |
|---|---|---|---|
| I-BS-CV | ✅ PASS | Neraca: Total aset 517.630.000 = Total liabilitas & ekuitas 517.630.000; badge Seimbang=true | [img](./screenshots/I-BS-CV-Aug.jpg) |
| I-PL-CV | ✅ PASS | Laba bersih Aug: ui=63.155.000 sql=63155000; YTD: ui=277.630.000 sql=277630000 | [img](./screenshots/I-PL-CV-Aug.jpg) |
| I-TB-BudiSantoso-2026-08 | ✅ PASS | Budi Santoso 2026-08: 8 accounts compared with SQL oracle, ΣDebit=411270000 ΣKredit=411270000 | [img](./screenshots/I-TB-BudiSantoso-2026-08.jpg) |
| I-TB-CVSinarRetail-2026-03 | ✅ PASS | CV Sinar Retail 2026-03: 11 accounts compared with SQL oracle, ΣDebit=480790000 ΣKredit=480790000 | [img](./screenshots/I-TB-CVSinarRetail-2026-03.jpg) |
| I-TB-CVSinarRetail-2026-06 | ✅ PASS | CV Sinar Retail 2026-06: 10 accounts compared with SQL oracle, ΣDebit=1173200000 ΣKredit=1173200000 | [img](./screenshots/I-TB-CVSinarRetail-2026-06.jpg) |
| I-TB-CVSinarRetail-2026-08 | ✅ PASS | CV Sinar Retail 2026-08: 11 accounts compared with SQL oracle, ΣDebit=1671270000 ΣKredit=1671270000 | [img](./screenshots/I-TB-CVSinarRetail-2026-08.jpg) |
| I-TB-PTAyamNusantar-2026-04 | ✅ PASS | PT Ayam Nusantara Digital 2026-04: 28 accounts compared with SQL oracle, ΣDebit=6680800000 ΣKredit=6680800000 | [img](./screenshots/I-TB-PTAyamNusantar-2026-04.jpg) |
| I-TB-PTAyamNusantar-2026-08 | ✅ PASS | PT Ayam Nusantara Digital 2026-08: 32 accounts compared with SQL oracle, ΣDebit=12995126146 ΣKredit=12995126146 | [img](./screenshots/I-TB-PTAyamNusantar-2026-08.jpg) |
| I-TB-PTJasaKreatifD-2026-05 | ✅ PASS | PT Jasa Kreatif Digital 2026-05: 11 accounts compared with SQL oracle, ΣDebit=946450000 ΣKredit=946450000 | [img](./screenshots/I-TB-PTJasaKreatifD-2026-05.jpg) |
| I-TB-PTJasaKreatifD-2026-08 | ✅ PASS | PT Jasa Kreatif Digital 2026-08: 11 accounts compared with SQL oracle, ΣDebit=1376150000 ΣKredit=1376150000 | [img](./screenshots/I-TB-PTJasaKreatifD-2026-08.jpg) |

## J

| Case | Result | Detail | Evidence |
|---|---|---|---|
| J1 | ✅ PASS | Lock disabled while controls need notes / checklist unticked / review pending: • 6 kontrol perlu dicek dan diberi catatan \| • 3 checklist belum dicentang | [img](./screenshots/J1-lock-disabled.jpg) |
| J2 | ✅ PASS | Sample BRI statement imported (live-upload moment): 5 transaksi diproses | [img](./screenshots/J2-sample-import.jpg) |
| J2b | ✅ PASS | Apotek Kimia Farma row present once (1) |  |
| J3 | ✅ PASS | Review queue cleared (0 left) | [img](./screenshots/J3-review-cleared.jpg) |
| J4 | ✅ PASS | Depreciation instalment 6180 Dr / 1219 Cr Rp 9.500.000 posted from 'Catat' (stored as kind ADJUSTMENT; earlier FAIL was a wrong filter in my test query) |  |
| J5 | ✅ PASS | 4-char note refused: "Tulis catatan singkat (min. 5 karakter)." | [img](./screenshots/J5-note-too-short.jpg) |
| J5a | ℹ️ NOTE | 2 controls need a note | [img](./screenshots/J5-controls-need-notes.jpg) |
| J5b | ✅ PASS | All REVIEW controls acknowledged (remaining 0) | [img](./screenshots/J5-controls-noted.jpg) |
| J5c | ✅ PASS | FAIL controls remaining: 0 |  |
| J6 | ✅ PASS | Lock stays disabled until sign-off checklist ticked | [img](./screenshots/J6-before-signoff.jpg) |
| J7 | ✅ PASS | Sign-offs persist after reload (3 ticked) | [img](./screenshots/J7-signoffs.jpg) |
| J8 | ✅ PASS | Aug 2026 lock -> Period.status=LOCKED; blockers seen: ; toast: Buku Agustus 2026 ditutup | [img](./screenshots/J8-locked.jpg) |
| J8b | ✅ PASS | Lock attribution recorded (lockedBy set=true) |  |

## K

| Case | Result | Detail | Evidence |
|---|---|---|---|
| K1 | ✅ PASS | Unbalanced journal blocked in UI (Simpan disabled=true); pill: Selisih Rp 100.000 | [img](./screenshots/K1-unbalanced.jpg) |
| K2 | ❌ FAIL | Typing "250,000" (Western thousands, very common from Excel/English keyboards): field re-displays "250", save enabled=true, posted amount=250 (expected Rp 250.000 or a rejection, never Rp 250) | [img](./screenshots/K2-western-separators.jpg) |
| K3 | ✅ PASS | Manual journal Dr 6190 / Cr 2150: ["2150 D0 K1250000","6190 D1250000 K0"]; toast Jurnal penyesuaian tersimpan | [img](./screenshots/K3-journal-saved.jpg) |
| K4 | ✅ PASS | Decimal Rupiah rejected inline: Rupiah tidak memakai angka desimal: "1000,5". | [img](./screenshots/K4-decimal-rupiah.jpg) |
| K5 | ✅ PASS | Negative amounts: save enabled=false, rows written=0 []; toast  | [img](./screenshots/K5-negative.jpg) |
| K6 | ℹ️ NOTE | Same account on both sides: ACCEPTED and posted (zero-effect journal) | [img](./screenshots/K6-same-account.jpg) |
| K7 | ❌ FAIL | 20-digit journal amount: enabled=true; message="Terjadi kesalahan tak terduga. Coba lagi." | [img](./screenshots/K7-huge-journal.jpg) |
| K8 | ✅ PASS | Balik jurnal creates a mirrored entry (6190 Cr / 2150 Dr 1.250.000) dated 2026-01-31; toast=Jurnal pembalik dicatat | [img](./screenshots/K8-after-reverse.jpg) |
| K8b | ✅ PASS | A journal can be reversed only once (second attempt blocked) | [img](./screenshots/K8b-second-reverse.jpg) |
| K9 | ❌ FAIL | 88 malformed-parameter requests: /?period=2026-13 -> 200 undefined 2026 \| /?period=2026-00 -> 200 undefined 2026 \| /reports?period=2026-13 -> 200 undefined 2026 \| /reports?period=2026-00 -> 200 undefined 2026 \| /trial-balance?period=2026-13 -> 200 undefined 2026 \| /trial-balance?period=2026-00 -> 200 undefined 2026 \| /close?period=2026-13 -> 200 undefined 2026 \| /close?p | [img](./screenshots/K9-last-fuzz-page.jpg) |

## L

| Case | Result | Detail | Evidence |
|---|---|---|---|
| L1 | ✅ PASS | PV of 24 × Rp 5.000.000 monthly in arrears @12% = Rp 106.216.936, equal to independent exact-rational calculation; liability after 1st payment 102.279.106 (=106.216.936×1,01−5.000.000); current/non-current split shown | [img](./screenshots/L1-lease-registered.jpg) |
| L2 | ℹ️ NOTE | Aug lease journal lines ["1239 D0 K4425705","2170 D0 K5499416","2400 D4437246 K0","6181 D4425705 K0","7195 D1062170 K0"]; oracle interest=1062169 (7195) ; depreciation≈4425706 (6181) | [img](./screenshots/L2-lease-journal-posted.jpg) |
| L2b | ✅ PASS | Wrong-account upload is refused with a one-click 'Pakai rekening …' switch (E05-style guard works for combined groups) |  |
| L3 | ✅ PASS | After posting the monthly journal, register vs ledger differs by exactly Rp 5.000.000 (Aug rent not yet paid from the bank); the app flags it and tells the accountant to classify the payment to 2170 — correct behaviour | [img](./screenshots/L3-register-vs-ledger.jpg) |

## LK

| Case | Result | Detail | Evidence |
|---|---|---|---|
| LK1 | ✅ PASS | July 2026 is LOCKED; Jurnal Penyesuaian shows: Buku Juli 2026 sudah ditutup, jadi jurnal bertanggal di bulan ini ditolak. Pilih bulan yang masih terbuka di kanan atas, atau minta admin me | [img](./screenshots/LK1-journal-locked-month.jpg) |
| LK2 | ✅ PASS | Statement with a row in locked July refused, nothing written: "Periode Juli 2026 sudah ditutup. Buka periode dulu atau pilih file lain." | [img](./screenshots/LK2-import-into-locked-month.jpg) |

## M

| Case | Result | Detail | Evidence |
|---|---|---|---|
| M1 | ✅ PASS | Faktur penjualan: PPN prefilled "1.100.000"; journal ["1130 D11100000 K0","2130 D0 K1100000","4100 D0 K10000000"] | [img](./screenshots/M1-invoice-saved.jpg) |
| M2 | ✅ PASS | PPN of 1.234.567: prefill "135.802" journal ["1130 D1370369 K0","2130 D0 K135802","4100 D0 K1234567"] (exact 135.802,37) |  |
| M3 | ✅ PASS | Duplicate invoice number refused (count 1): "Nomor INV-QA-001 sudah dipakai untuk faktur lain entitas ini." | [img](./screenshots/M3-duplicate-number.jpg) |
| M4 | ✅ PASS | Due date before issue date refused: enabled=true; "Jatuh tempo tidak boleh sebelum tanggal faktur." | [img](./screenshots/M4-due-before-issue.jpg) |
| M5 | ✅ PASS | Invoice dated in a locked month refused: "Periode Juni 2026 sudah ditutup" | [img](./screenshots/M5-invoice-locked-month.jpg) |
| M6 | ✅ PASS | PPh 23 2% on DPP 20.000.000: {"dpp":"20000000","ppn":"2200000","total":"22200000","whtKind":"PPH_23","w":"400000"}; receivable booked gross (expected 1130 Dr 22.200.000, WHT 400.000 recorded for settlement) | [img](./screenshots/M6-invoice-wht.jpg) |
| M7 | ℹ️ NOTE | Aging card text: Umur piutang · CV Sinar Sisa per pelanggan menurut hari lewat jatuh tempo (rinciannya di layar lebar). Cocok dengan buku besar PELANGGAN BELUM JATUH TEMPO 1–30 HARI 31–60 HARI 61–90 HARI > 90 HARI JUMLAH PT Pelanggan Uji · 3 faktur 33.300.000 1.370.369 – – – 34.670.369 Jumlah 33.300.000 1.370.369 –  | [img](./screenshots/M7-aging.jpg) |
| M8 | ✅ PASS | Bank-line candidate suggested by amount+name: TRSF E-BANKING CR 2308/FTSCY/WS925952 PT KOPERASI PEGAWAI PEMDA BELANJA GROSIR 23 Agu 2026 · sisa Rp 14.300.000 · nominal sama · nama/nomor cocok · akan diklasi | [img](./screenshots/M8-settle-candidates.jpg) |
| M9 | ✅ PASS | Settlement: bank line -> {"status":"REVIEWED","accountCode":"1130"}; 1130 balance 48970369 -> 34670369 (expected -14.300.000); invoice {}; toast INV-QA-008 dicocokkan dengan penerimaan 23 Agu 2026 | [img](./screenshots/M9-settled.jpg) |
| M10 | ✅ PASS | Settled invoice moves to the paid list | [img](./screenshots/M10-paid-list.jpg) |

## N

| Case | Result | Detail | Evidence |
|---|---|---|---|
| N1 | ✅ PASS | Register Laptop QA 12.000.000: book life prefilled "48" months (Kelompok 1 = 4 yrs → 48); schedule [{"months":48,"amt":"12000000","startMonth":9}]; toast Laptop QA terdaftar | [img](./screenshots/N1-asset-registered.jpg) |
| N3 | ℹ️ NOTE | Mesin QA (Kel.2, saldo menurun) enabled=true; toast=April 2026 sudah dikunci, jadi cicilan di bulan itu tidak bisa dicatat. Buka kunci bulan itu atau mulai jadwal setelahnya. | [img](./screenshots/N3-mesin-registered.jpg) |
| N5a | ✅ PASS | Zero cost is refused by the server with "Harga perolehan harus lebih dari nol." (button enabled; validated on save) |  |
| N5b | ✅ PASS | Residual > cost refused: "Nilai sisa harus nol atau lebih, dan kurang dari harga perolehan." | [img](./screenshots/N5b-residual-gt-cost.jpg) |
| N5c | ✅ PASS | Cost typed "5,000,000": [] (the Western-separator misread, see K2) | [img](./screenshots/N5c-western-cost.jpg) |

## O

| Case | Result | Detail | Evidence |
|---|---|---|---|
| O1 | ✅ PASS | Saldo Awal 31-Dec-2025 (Dr 210M, Cr 185M): unbalanced remainder plugged to 3200 Saldo Laba = 25000000; ΣD=210000000 ΣK=210000000; UI hint: Selisih debit dan kredit otomatis masuk ke 3200 Saldo Laba. / 3200 Saldo Laba · penyeimbang otomatis	–	25.000.000	; lines=["1101 D100000000 K0","1130 D20000000 K0","1160 D30000000 K0","1210 D60000000 K0","1219 D0 K10000000","2110 D0 K2500000 | [img](./screenshots/O1-opening-posted.jpg) |
| O2 | ✅ PASS | Opening cannot be entered twice: (form still shown) | [img](./screenshots/O2-opening-twice.jpg) |

## P

| Case | Result | Detail | Evidence |
|---|---|---|---|
| P1 | ✅ PASS | Stock opname 100.000.000 vs book 95000000: ["1160 D5000000 K0","5190 D0 K5000000"]; toast Persediaan akhir CV Sinar dicatat; selisih Rp 5.000.000 dijurnal ke 5190 | [img](./screenshots/P1-inventory-counted.jpg) |
| P2 | ✅ PASS | HPP Aug = pembelian 158.600.000 − kenaikan persediaan 5.000.000 = 153.600.000; page: Beban pokok pendapatan	153.600.000	921.550.000 | [img](./screenshots/P2-hpp-after-count.jpg) |
| P3 | ✅ PASS | Negative stock count: server answer "Nilai persediaan tidak boleh negatif." | [img](./screenshots/P3-negative-stock.jpg) |

## Q

| Case | Result | Detail | Evidence |
|---|---|---|---|
| Q1 | ✅ PASS | Client with an IDR entity and a USD foreign entity created: /clients/cmuqcdewh00w8b87dmd3dhdbm/import Grup Valas Uji ditambahkan | [img](./screenshots/Q1-valas-client-created.jpg) |
| Q3a | ℹ️ NOTE | USD→IDR typed "16.250,50" -> toast "Kurs USD→IDR disimpan"; last stored: {"id":"cmuqcdic300ydb87dv58oc8uj","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-11T00:00:00.000Z","kind":"SPOT","rate":"16250.5","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:26.451Z"} | [img](./screenshots/Q3a-rate.jpg) |
| Q3b | ℹ️ NOTE | USD→IDR typed "16250.50" -> toast "Kurs USD→IDR disimpan"; last stored: {"id":"cmuqcdjxe00yeb87djkydhrhf","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-12T00:00:00.000Z","kind":"SPOT","rate":"16250.5","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:28.514Z"} | [img](./screenshots/Q3b-rate.jpg) |
| Q3c | ℹ️ NOTE | USD→IDR typed "16.250" -> toast "Kurs USD→IDR disimpan"; last stored: {"id":"cmuqcdlia00yfb87dx14wxciw","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-13T00:00:00.000Z","kind":"SPOT","rate":"16250","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:30.562Z"} | [img](./screenshots/Q3c-rate.jpg) |
| Q3d | ℹ️ NOTE | USD→IDR typed "-5" -> toast "Kurs harus angka positif, mis. "11.250" atau "1.31"."; last stored: {"id":"cmuqcdlia00yfb87dx14wxciw","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-13T00:00:00.000Z","kind":"SPOT","rate":"16250","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:30.562Z"} | [img](./screenshots/Q3d-rate.jpg) |
| Q3e | ℹ️ NOTE | USD→IDR typed "0" -> toast "Kurs harus angka positif, mis. "11.250" atau "1.31"."; last stored: {"id":"cmuqcdlia00yfb87dx14wxciw","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-13T00:00:00.000Z","kind":"SPOT","rate":"16250","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:30.562Z"} | [img](./screenshots/Q3e-rate.jpg) |
| Q3f | ℹ️ NOTE | USD→IDR typed "abc" -> toast "Kurs harus angka positif, mis. "11.250" atau "1.31"."; last stored: {"id":"cmuqcdlia00yfb87dx14wxciw","firmId":"firm_qa_b","currency":"USD","quote":"IDR","date":"2026-08-13T00:00:00.000Z","kind":"SPOT","rate":"16250","source":"MANUAL","note":null,"createdAt":"2026-10-02T02:26:30.562Z"} | [img](./screenshots/Q3f-rate.jpg) |
| Q4 | ❌ FAIL | SGD→USD typed "0.745" (a real cross rate): toast "Kurs SGD→USD disimpan"; stored {"c":"SGD","q":"USD","r":"745"} (expected 0.745) | [img](./screenshots/Q4-cross-rate-0.745.jpg) |

## R

| Case | Result | Detail | Evidence |
|---|---|---|---|
| R1 | ✅ PASS | Tanya Buku "laba tiap perusahaan" vs SQL: Budi Santoso=45.000; CV Sinar Retail=106.784.575; PT Ayam Nusantara Digital=202.468.412; PT Jasa Kreatif Digital=16.940.653; not found in answer: none | [img](./screenshots/R1-tanya-laba.jpg) |
| R2 | ✅ PASS | Unsupported question answered with a limit notice: Pertanyaan ini belum didukung. Coba kesiapan tutup buku, laba, saldo kas, transfer ke/dari nama tertentu, transaksi yang perlu ditanyakan ke klien, pr | [img](./screenshots/R2-tanya-unsupported.jpg) |
| R3 | ✅ PASS | HTML in question rendered inert (dialogs=0, imgs=0) | [img](./screenshots/R3-tanya-xss.jpg) |
| R4 | ℹ️ NOTE | 2001-char question: button enabled=true; message  | [img](./screenshots/R4-tanya-too-long.jpg) |
| R5 | ✅ PASS | Close-readiness answer names clients | [img](./screenshots/R5-tanya-close.jpg) |

## S

| Case | Result | Detail | Evidence |
|---|---|---|---|
| S1 | ✅ PASS | Key with spaces refused: "Kunci API tidak valid. Tempel kunci lengkap tanpa spasi." | [img](./screenshots/S1-bad-key.jpg) |
| S2 | ✅ PASS | AI key saved: Pengaturan AI tersimpan \| Kunci API tidak valid. Tempel kunci lengkap tanpa spasi.; stored encrypted (plaintext absent from AppSetting=true); keys: ai.apiKey,ai.model | [img](./screenshots/S2-key-saved.jpg) |
| S3 | ℹ️ NOTE | Design gap: the AI key/model (AppSetting) has no firmId. A second firm's ADMIN sees ••••XYZ of the first firm's key and can overwrite/clear it. ADR 0008 makes a deployment single-firm, so this only bites if a second firm is ever provisioned in the same deployment. | [img](./screenshots/S3-firmB-sees-firmA-key.jpg) |

## T

| Case | Result | Detail | Evidence |
|---|---|---|---|
| T1 | ✅ PASS | Pasal 31E partial: facility PKP = PKP×4,8M/turnover = 716658532 (app 716.658.532); 11% → 78832438; rest 603120468 ×22% → 132686502; total 211518940 (app 211.518.940) | [img](./screenshots/crawl/GrupAyamNusantara_tax.jpg) |
| T2 | ✅ PASS | PP 55/2022 final 0,5% of turnover 1469487450 = 7347437 (floor); page contains "7.347.437": true | [img](./screenshots/T2-final-regime-pp55.jpg) |
| T2b | ✅ PASS | Switching back to Normal restores Pasal 17/31E computation | [img](./screenshots/T2b-normal-restored.jpg) |

## U

| Case | Result | Detail | Evidence |
|---|---|---|---|
| U1 | ✅ PASS | AKUNTAN cannot reopen: unlock button visible=false; response=""; period still LOCKED | [img](./screenshots/U1-akuntan-unlock.jpg) |
| U2 | ✅ PASS | Reopen confirm button disabled for a 4-char reason (disabled=true) | [img](./screenshots/U2-reason-too-short.jpg) |
| U3 | ✅ PASS | ADMIN reopen with reason: status=OPEN; unlock log kept; sign-offs cleared (left 0) | [img](./screenshots/U2-reason-too-short.jpg) |

## UO

| Case | Result | Detail | Evidence |
|---|---|---|---|
| UO1 | ✅ PASS | June cannot be reopened while July is locked (unlock disabled=true): Buka kembali Juli 2026 dulu: bulan setelahnya masih ditutup. | [img](./screenshots/UO1-unlock-order.jpg) |

## V

| Case | Result | Detail | Evidence |
|---|---|---|---|
| V1 | ✅ PASS | Ledger file checks flag problems with row refs: {"unbalanced":true,"broken":true,"reused":true}; excerpt: 1. Pemeriksaan file \| Aturan tetap, bukan AI. Setiap temuan menunjuk ke baris di file (GL!baris). \| Harus diselesaikan \| GL!6: debit bukan angka: "abc" \| GL!6 \| Harus diselesaikan \| Jurnal PT Migrasi Uji Sejahtera 9 Jan 2026 tidak seimbang: selisih Rp 100.000 (debit > | [img](./screenshots/V1-ledger-import-checks.jpg) |
| V2 | ✅ PASS | Nothing posted from a flawed file (journals=0); post button enabled=false | [img](./screenshots/V2-post-blocked.jpg) |
| V3 | ❌ FAIL | Ledger/Neraca file with an Indonesian-format TEXT rate "15.750,50" is read as 15.75050 (≈ 1000× too small); no row error. Numeric rate cells are fine (read.ts strips every comma) | [img](./screenshots/V1-ledger-import-checks.jpg) |

## VF

| Case | Result | Detail | Evidence |
|---|---|---|---|
| VF-002 | ✅ PASS | SheetJS ISO-date workbook now imports dates ["2026-10-02","2026-10-05"] (was 1905-07-18) | [img](./screenshots/fixed/VF-002-xlsx-iso-dates.jpg) |
| VF-003 | ✅ PASS | "250,000" is refused inline (Simpan disabled=true): Nominal "250,000" bisa dibaca ribuan atau desimal. Tulis ribuan dengan titik, misalnya 1.250.000. | [img](./screenshots/fixed/VF-003-western-separators.jpg) |
| VF-003b | ✅ PASS | Indonesian 250.000 still accepted |  |
| VF-004 | ✅ PASS | Newest-first export: opening 100000000 closing 103500000 continuityOk=true (was 100.500.000 / 101.000.000 / false) | [img](./screenshots/fixed/VF-004-newest-first.jpg) |
| VF-004b | ✅ PASS | Saldo Awal prefill is the true opening 100.000.000 | [img](./screenshots/fixed/VF-004b-opening-prefill.jpg) |
| VF-005 | ✅ PASS | SGD→USD "0.745" => 0.745 (exp 0.745); EUR→USD "1.085" => 1.085 (exp 1.085); USD→IDR "16.250" => 16250 (exp 16250); JPY→IDR "105.234" => 105.234 (exp 105.234); USD→IDR "16.250,50" => 16250.5 (exp 16250.5) | [img](./screenshots/fixed/VF-005-rates.jpg) |
| VF-007 | ✅ PASS | 16 pages with month 13/00: "undefined" on 0; export file name attachment; filename="laporan-keuangan-CV_Sinar_Retail-Oktober-2026.xlsx" | [img](./screenshots/fixed/VF-007-month-13.jpg) |
| VF-008 | ✅ PASS | 6.5 MB file: page intact; toast "File terlalu besar (maks. 5 MB)." | [img](./screenshots/fixed/VF-008-oversize-friendly.jpg) |
| VF-009 | ✅ PASS | Zero-amount row skipped, other row imported (1); page note: 1 baris bernilai nol dilewati (baris 4): tidak ada uang yang bergerak. | [img](./screenshots/fixed/VF-009-zero-row.jpg) |
| VF-010a | ✅ PASS | 20-digit statement amount: "Nominal terlalu besar di baris 4 (maks. 15 angka). Periksa kolom jumlah dan saldo di file." | [img](./screenshots/fixed/VF-010a-huge-statement.jpg) |
| VF-010b | ✅ PASS | 20-digit journal amount refused inline: Nominal terlalu besar (maks. 15 angka): "99.999.999.999.999.999.999". | [img](./screenshots/fixed/VF-010b-huge-journal.jpg) |
| VF-011a | ✅ PASS | 19-digit NPWP is now rejected with the field message | [img](./screenshots/fixed/VF-011a-npwp-19-digits.jpg) |
| VF-011b | ✅ PASS | 15 digits typed without separators are stored normalised: 01.234.567.8-015.000 |  |
| VF-012 | ✅ PASS | Impor page at 390 px: scrollWidth 390 / clientWidth 390 (was 462 / 390) | [img](./screenshots/fixed/VF-012-mobile-import.jpg) |
| VF-013 | ✅ PASS | 18 distinct titles on 18 pages, e.g. Beranda · Buku \| Laporan · Buku \| Dokumen · Buku \| Pengaturan · Buku |  |
| VF-014a | ✅ PASS | Lease toast: "Sewa Gudang Fix didaftarkan" |  |
| VF-014b | ✅ PASS | 2000-char unbroken question: article horizontal overflow 0px | [img](./screenshots/fixed/VF-014b-long-question.jpg) |

## X

| Case | Result | Detail | Evidence |
|---|---|---|---|
| X1 | ✅ PASS | Financial statements export: 200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; attachment; filename="laporan-keuangan-CV_Sinar_Retail-Agustus-2026.xlsx"; 17448B; sheets Neraca(39r), Laba Rugi(27r), Perubahan Ekuitas(10r), Arus Kas(22r), CALK(137r), Pernyataan Pengurus(14r) |  |
| X2 | ✅ PASS | Excel Laba Rugi is a YTD presentation (1 Jan–31 Aug 2026 vs prior year): Laba bersih 321.259.575 = SQL YTD (month-only column is on screen, not in the Excel) |  |
| X3 | ✅ PASS | Unlocked month is stamped draft in the Excel: Per 31 Agu 2026 dan untuk periode yang berakhir pada tanggal tersebut (draf) |  |
| X4 | ✅ PASS | Tax workpaper export: 200; attachment; filename="kertas-kerja-pph-badan-CV_Sinar-2026-08.xlsx"; sheets Rekonsiliasi Fiskal, Koreksi Fiskal, Laba Rugi, Kompensasi Kerugian, Kredit Pajak, Pajak Tangguhan, Jurnal |  |
| X5a | ✅ PASS | entity=zzz silently falls back to the default scope and exports normally (200) |  |
| X5b | ❌ FAIL | period=2026-13 export returns 200 with file name laporan-keuangan-CV_Sinar_Retail-undefined-2026.xlsx (same invalid-month bug as the pages) |  |
| X5c | ✅ PASS | period=2026-08 -> 400 Pilih badan usaha dengan pembukuan Rupiah |  |
| X6 | ℹ️ NOTE | Excel uses static values (no formulas): an accountant cannot trace/adjust numbers inside the workbook |  |

## Y

| Case | Result | Detail | Evidence |
|---|---|---|---|
| Y1 | ❌ FAIL | Mobile 390px: 20 pages; horizontal page overflow on: /clients/:id/import (scrollW 462 > 390; ) | [img](./screenshots/mobile/_clients_id_import.jpg) |
| Y2 | ✅ PASS | A11y scan on 20 pages: every visible input labelled, no nameless buttons/links, one h1 per page (the 2 flagged inputs are aria-hidden helpers of the Select component) |  |
| Y3 | ℹ️ NOTE | Document titles: Buku · tutup buku bulanan untuk kantor akuntan (1 distinct across 18 pages) — identical titles make browser tabs/history/screen-reader page changes indistinguishable |  |

## Z

| Case | Result | Detail | Evidence |
|---|---|---|---|
| Z1 | ✅ PASS | Two sessions accepting the same Rp 8.400.000 review line at the same instant produced exactly one BANK + one RECLASS entry (net 6160 = 8.400.000, 1999 = 0). Race hypothesis from code review NOT reproduced in 1 attempt (not a proof of absence) | [img](./screenshots/Z1-concurrent-accept.jpg) |

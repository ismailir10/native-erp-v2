import { ppnLine, pph25Notes, pph25StateLabel, previousStateLabel, rowNotes, terNote, terRow, withholdingLabel, type MasaReport } from "@/lib/tax/masa-report";
import { formatDate, formatPeriod } from "@/lib/format";
import { newWorkbook, n, type WorkbookMeta } from "@/lib/reports/workbook";
import { DIRECTION_LABEL, type FakturRecon } from "@/lib/tax/faktur";
import { BUPOT_DIRECTION_LABEL, type BupotRecon } from "@/lib/tax/bupot";
import { BUPOT_KIND_LABEL } from "@/lib/tax/bupot-read";
import { PTKP_LABEL } from "@/lib/tax/ter";

/** Kertas kerja pajak masa (I4c): the same report the page shows, never a second computation. Whole Rupiah as Excel numbers. */
export async function masaWorkbook(r: MasaReport, meta: WorkbookMeta, faktur?: FakturRecon, bupot?: BupotRecon): Promise<Buffer> {
  const book = newWorkbook(meta);
  const { sheet, head } = book;
  const label = formatPeriod(r.masa.year, r.masa.month);
  const sub = `${r.entity.name}${r.entity.npwp ? ` · NPWP ${r.entity.npwp}` : ""} · masa ${label} · kertas kerja, bukan SPT`;

  const ws = sheet("Ringkasan", "Rekonsiliasi pajak masa", sub, [22, 18, 16, 18, 18, 18, 18, 18, 80]);
  head(ws, ["Pajak", "Terutang masa ini", "Jatuh tempo", "Masa lalu terutang", "Disetor s.d. jatuh tempo", "Belum disetor", "Saldo akun akhir bulan", "Status", "Catatan"]);
  for (const x of r.rows) {
    const paid = x.previous.paid.reduce((s, p) => s + p.amount, 0n);
    const row = ws.addRow([`${x.label} (${x.code})`, n(x.owed), formatDate(x.due), n(x.previous.owed), n(paid), n(x.previous.short), n(x.balance), `${x.status === "PASS" ? "Lolos" : "Perlu dicek"} · ${previousStateLabel(x.previous.state)}`, rowNotes(x).join(" ")]);
    row.getCell(3).numFmt = "@";
    row.getCell(8).numFmt = "@";
    row.getCell(9).numFmt = "@";
    if (x.ppn) ws.addRow([ppnLine(x.ppn)]);
  }
  if (r.pph25) {
    // PPh 25 is an instalment paid ahead (1180), not a payable: no owed balance, so the balance column stays empty.
    const p = r.pph25;
    const paid = p.previous.paid.reduce((s, x) => s + x.amount, 0n);
    const row = ws.addRow(["PPh 25 (angsuran)", p.current.expected === null ? "" : n(p.current.expected), formatDate(p.current.due), p.previous.expected === null ? "" : n(p.previous.expected), n(paid), n(p.previous.short), "", `${p.status === "PASS" ? "Lolos" : "Perlu dicek"} · ${pph25StateLabel(p.previous.state)}`, pph25Notes(p).join(" ")]);
    row.getCell(3).numFmt = "@";
    row.getCell(8).numFmt = "@";
    row.getCell(9).numFmt = "@";
  }
  ws.addRow([]);
  ws.addRow(["Jatuh tempo setor: PPh tanggal 15 bulan berikutnya, PPN akhir bulan berikutnya (PMK 81/2024); hari libur menggeser ke hari kerja berikutnya."]);
  ws.addRow(["Setoran dihitung dari mutasi bank yang diklasifikasikan ke akun pajaknya."]);

  const bp = sheet("Bukti Potong", "Pemotongan pajak masa ini (Unifikasi)", sub, [14, 34, 24, 44, 12, 18, 18, 18, 14]);
  const list = (title: string, lines: MasaReport["withheldByUs"], empty: string) => {
    bp.addRow([title]).font = { bold: true };
    head(bp, ["Tanggal", "Lawan transaksi", "NPWP", "Keterangan bank", "Jenis", "Dibayar / diterima", "Dipotong", "Bruto", "Status"]);
    if (!lines.length) bp.addRow(["", empty]);
    for (const w of lines) {
      const row = bp.addRow([formatDate(w.date), w.contact?.name ?? "(belum ditautkan)", w.contact?.npwp ?? "", w.description, withholdingLabel(w.kind), n(w.cash), n(w.withheld), n(w.gross), w.inReview ? "Belum direview" : ""]);
      row.getCell(3).numFmt = "@";
      row.getCell(5).numFmt = "@";
    }
    bp.addRow([]);
  };
  list("Dipotong oleh perusahaan: buat bukti potong di Coretax", r.withheldByUs, "Tidak ada pemotongan oleh perusahaan masa ini.");
  list("Dipotong oleh pelanggan: minta bukti potongnya", r.withheldFromUs, "Tidak ada pemotongan oleh pelanggan masa ini.");
  // Bukti potong Unifikasi (I5d): the Coretax slips against these lines, once slips of the masa were imported.
  if (bupot?.any) {
    bp.addRow(["Cocokkan dengan Coretax"]).font = { bold: true };
    for (const d of bupot.directions.filter((x) => x.imported > 0)) {
      bp.addRow([BUPOT_DIRECTION_LABEL[d.direction]]).font = { bold: true };
      head(bp, ["", "", "", "", "", "PPh bukti potong", "PPh di buku", "Selisih", "Status"]);
      const sum = bp.addRow(["Jumlah", "", "", "", "", n(d.slipPph), n(d.bookPph), n(d.difference), d.status === "MATCH" ? "Cocok" : "Selisih"]);
      sum.getCell(9).numFmt = "@";
      for (const x of d.unmatchedSlips) bp.addRow([formatDate(x.date), x.name, x.npwp ?? "", `Bukti potong ${x.number} tanpa pemotongan di buku`, BUPOT_KIND_LABEL[x.kind], n(x.pph), "", "", ""]).getCell(3).numFmt = "@";
      for (const x of d.unmatchedBook) bp.addRow([formatDate(x.date), x.contact ?? "", x.npwp ?? "", `${x.description}: pemotongan di buku tanpa bukti potong`, BUPOT_KIND_LABEL[x.kind], "", n(x.pph), "", ""]).getCell(3).numFmt = "@";
      for (const p of d.kindDiffers) bp.addRow([formatDate(p.slip.date), p.slip.name, p.slip.npwp ?? "", `Bukti potong ${p.slip.number}: ${BUPOT_KIND_LABEL[p.slip.kind]}, di buku ${BUPOT_KIND_LABEL[p.book.kind]}`, "Beda jenis", n(p.slip.pph), n(p.book.pph), "", ""]).getCell(3).numFmt = "@";
      bp.addRow([]);
    }
  }
  bp.addRow(["PPh 21 tidak masuk Unifikasi: bukti potongnya dibuat per penerima di e-Bupot 21/26."]);

  const december = r.masa.month === 12;
  const ter = december
    ? sheet("PPh 21 TER", "PPh 21 Desember: Pasal 17 setahun dikurangi TER Januari–November (PMK 168/2023)", `${sub} · estimasi dari upah sensus; THR, bonus dan iuran JHT / JP karyawan belum termasuk`, [32, 14, 10, 8, 18, 16, 16, 16, 16, 18, 18])
    : sheet("PPh 21 TER", "PPh 21 dengan tarif efektif rata-rata (PP 58/2023)", `${sub} · estimasi dari upah sensus`, [32, 14, 10, 10, 18, 10, 18]);
  ter.addRow([terNote(r.ter)]);
  ter.addRow([]);
  if (r.ter.state === "ANNUAL") {
    head(ter, ["Nama", "No. karyawan", "PTKP", "Bulan", "Bruto setahun", "Biaya jabatan", "PTKP (Rp)", "PKP", "PPh setahun", "TER Jan–Nov", "PPh 21 Desember"]);
    for (const e of r.ter.employees) {
      const row = ter.addRow([e.name, e.employeeNo ?? "", PTKP_LABEL[e.status], e.months, n(e.gross), n(e.biayaJabatan), n(e.ptkp), n(e.pkp), n(e.annual), n(e.ter), n(e.december)]);
      for (const c of [2, 3]) row.getCell(c).numFmt = "@";
    }
    const total = ter.addRow(["Jumlah estimasi PPh 21 Desember", "", "", "", "", "", "", "", "", "", n(r.ter.estimate)]);
    total.font = { bold: true };
    ter.addRow(["PPh 21 terutang di buku besar (2140)", "", "", "", "", "", "", "", "", "", n(r.ter.booked)]);
  }
  if (r.ter.state === "CHECKED") {
    head(ter, ["Nama", "No. karyawan", "PTKP", "Kategori", "Upah", "Tarif", "PPh 21"]);
    for (const e of r.ter.employees.map(terRow)) {
      const row = ter.addRow([e.name, e.employeeNo ?? "", e.statusLabel, e.category, n(e.wage), e.rateLabel, n(e.tax)]);
      for (const c of [2, 3, 4, 6]) row.getCell(c).numFmt = "@";
    }
    const total = ter.addRow(["Jumlah estimasi", "", "", "", "", "", n(r.ter.estimate)]);
    total.font = { bold: true };
    ter.addRow(["PPh 21 terutang di buku besar (2140)", "", "", "", "", "", n(r.ter.booked)]);
  }

  // Ekualisasi PPN (I5c): only once Coretax faktur of the masa were imported.
  if (faktur?.any) {
    const ek = sheet("Ekualisasi PPN", "Ekualisasi PPN: faktur Coretax vs buku", `${sub} · faktur dari ekspor Coretax, buku dari buku besar`, [24, 14, 22, 36, 18, 18, 30]);
    for (const d of faktur.directions.filter((x) => x.imported > 0)) {
      ek.addRow([`${DIRECTION_LABEL[d.direction]} (${d.account})`]).font = { bold: true };
      head(ek, ["", "PPN faktur", "PPN di buku", "Selisih", "Status"]);
      const sum = ek.addRow(["Jumlah", n(d.fakturPpn), n(d.bookPpn), n(d.difference), d.status === "MATCH" ? "Cocok" : "Selisih"]);
      sum.getCell(5).numFmt = "@";
      const list = (title: string, rows: (string | number)[][], cols: string[]) => {
        if (!rows.length) return;
        ek.addRow([title]).font = { bold: true };
        head(ek, cols);
        for (const x of rows) {
          const row = ek.addRow(x);
          row.getCell(1).numFmt = "@";
        }
      };
      list("Faktur belum ada di buku", d.unmatchedFaktur.map((f) => [f.number, formatDate(f.date), f.npwp ?? "", f.name, n(f.dpp), n(f.ppn), `${f.fileName} ${f.sourceRef}`]), ["Nomor faktur", "Tanggal", "NPWP", "Lawan transaksi", "DPP", "PPN", "Sumber"]);
      list("PPN di buku tanpa faktur", d.unmatchedBook.map((b) => [formatDate(b.date), b.kind === "BANK" ? "Mutasi bank" : b.kind === "INVOICE" ? "Faktur penjualan/pembelian" : "Jurnal", "", b.label, "", n(b.ppn), ""]), ["Tanggal", "Sumber", "", "Keterangan", "", "PPN", ""]);
      list("Cocok", d.matched.map((m) => [m.faktur.number, formatDate(m.faktur.date), m.faktur.npwp ?? "", m.faktur.name, n(m.faktur.dpp), n(m.faktur.ppn), m.book.label]), ["Nomor faktur", "Tanggal", "NPWP", "Lawan transaksi", "DPP", "PPN", "Di buku"]);
      list("Tidak dihitung", [...d.notCounted, ...d.uncredited].map((f) => [f.number, formatDate(f.date), f.npwp ?? "", f.name, n(f.dpp), n(f.ppn), f.status || "belum dikreditkan"]), ["Nomor faktur", "Tanggal", "NPWP", "Lawan transaksi", "DPP", "PPN", "Status"]);
      ek.addRow([]);
    }
  }
  return Buffer.from(await book.wb.xlsx.writeBuffer());
}

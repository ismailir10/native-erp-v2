import { ppnLine, previousStateLabel, rowNotes, terNote, terRow, withholdingLabel, type MasaReport } from "@/lib/tax/masa-report";
import { formatDate, formatPeriod } from "@/lib/format";
import { newWorkbook, n, type WorkbookMeta } from "@/lib/reports/workbook";

/** Kertas kerja pajak masa (I4c): the same report the page shows, never a second computation. Whole Rupiah as Excel numbers. */
export async function masaWorkbook(r: MasaReport, meta: WorkbookMeta): Promise<Buffer> {
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

  const ter = sheet("PPh 21 TER", "PPh 21 dengan tarif efektif rata-rata (PP 58/2023)", `${sub} · estimasi dari upah sensus`, [32, 14, 10, 10, 18, 10, 18]);
  ter.addRow([terNote(r.ter)]);
  ter.addRow([]);
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
  return Buffer.from(await book.wb.xlsx.writeBuffer());
}

import ExcelJS from "exceljs";

/** Writers for the three bank export formats the parsers read. Used by the demo generator. */
export type StatementRow = { date: Date; description: string; amount: bigint };
export type StatementFile = {
  bank: "BCA" | "MANDIRI" | "BRI";
  accountNumber: string;
  holder: string;
  year: number;
  month: number;
  opening: bigint;
  rows: StatementRow[];
};

const pad = (n: number) => String(n).padStart(2, "0");
/** Amount columns are unsigned (direction is a separate column); balances keep their sign. */
const en = (v: bigint, signed = false) => {
  const abs = v < 0n ? -v : v;
  return `${signed && v < 0n ? "-" : ""}${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.00`;
};
const id = (v: bigint, signed = false) => {
  const abs = v < 0n ? -v : v;
  return `${signed && v < 0n ? "-" : ""}${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},00`;
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function withBalances(f: StatementFile) {
  let bal = f.opening;
  return f.rows.map((r) => {
    bal += r.amount;
    return { ...r, balance: bal };
  });
}

export function closingOf(f: StatementFile) {
  return f.rows.reduce((s, r) => s + r.amount, f.opening);
}

export function toBcaCsv(f: StatementFile): string {
  const rows = withBalances(f);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const credits = f.rows.filter((r) => r.amount > 0n).reduce((s, r) => s + r.amount, 0n);
  const debits = f.rows.filter((r) => r.amount < 0n).reduce((s, r) => s - r.amount, 0n);
  return [
    "Informasi Rekening - Mutasi Rekening",
    `No. rekening : ${f.accountNumber}`,
    `Nama : ${f.holder.toUpperCase()}`,
    `Periode : 01/${pad(f.month)}/${f.year} - ${lastDay(f.year, f.month)}/${pad(f.month)}/${f.year}`,
    "Kode Mata Uang : IDR",
    "",
    "Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo",
    ...rows.map((r) => `'${pad(r.date.getUTCDate())}/${pad(r.date.getUTCMonth() + 1)},${q(r.description)},'0000,${q(en(r.amount))},${r.amount < 0n ? "DB" : "CR"},${q(en(r.balance, true))}`),
    "",
    q(`Saldo Awal : ${en(f.opening, true)}`),
    q(`Mutasi Kredit : ${en(credits)}`),
    q(`Mutasi Debet : ${en(debits)}`),
    q(`Saldo Akhir : ${en(closingOf(f), true)}`),
    "",
  ].join("\n");
}

export function toBriCsv(f: StatementFile): string {
  const rows = withBalances(f);
  const plain = (v: bigint, signed = false) => `${signed && v < 0n ? "-" : ""}${(v < 0n ? -v : v).toString()}.00`;
  return [
    `NOREK;${f.accountNumber}`,
    `NAMA;${f.holder.toUpperCase()}`,
    "TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI",
    ...rows.map((r) =>
      [r.date.toISOString().slice(0, 10), r.description.replace(/;/g, " "), r.amount < 0n ? plain(r.amount) : "0.00", r.amount > 0n ? plain(r.amount) : "0.00", plain(r.balance, true)].join(";"),
    ),
    "",
  ].join("\n");
}

export async function toMandiriXlsx(f: StatementFile): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Mutasi");
  ws.addRow(["Bank Mandiri - Laporan Mutasi Rekening"]);
  ws.addRow([`Rekening: ${f.accountNumber} a.n. ${f.holder.toUpperCase()}`]);
  ws.addRow([`Periode: 01/${pad(f.month)}/${f.year} - ${lastDay(f.year, f.month)}/${pad(f.month)}/${f.year}`]);
  ws.addRow([]);
  ws.addRow(["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"]);
  for (const r of withBalances(f)) {
    ws.addRow([
      `${pad(r.date.getUTCDate())}/${pad(r.date.getUTCMonth() + 1)}/${r.date.getUTCFullYear()}`,
      r.description,
      r.amount < 0n ? id(r.amount) : "0,00",
      r.amount > 0n ? id(r.amount) : "0,00",
      id(r.balance, true),
    ]);
  }
  ws.columns.forEach((c, i) => (c.width = [12, 60, 18, 18, 20][i]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function renderStatement(f: StatementFile): Promise<{ fileName: string; data: Buffer }> {
  const base = `${f.bank}-${f.accountNumber.slice(-4)}-${f.year}-${pad(f.month)}`;
  if (f.bank === "MANDIRI") return { fileName: `${base}.xlsx`, data: await toMandiriXlsx(f) };
  if (f.bank === "BRI") return { fileName: `${base}.csv`, data: Buffer.from(toBriCsv(f)) };
  return { fileName: `${base}.csv`, data: Buffer.from(toBcaCsv(f)) };
}

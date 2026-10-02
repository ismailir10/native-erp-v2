import ExcelJS from "exceljs";
import type { Db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { exponentOf } from "@/lib/fx/currency";

/**
 * The questions for the client (use-case feedback UC-B3): every bank line still waiting in Review, largest amount first, with Buku's
 * suggestion and an empty column for the client's answer. Read-only; the answers come back through Review.
 */
export type OwnerQuestion = { date: Date; entity: string; bank: string; description: string; amount: bigint; currency: string; suggestion: string | null };

export async function ownerQuestions(db: Db, args: { firmId: string; clientId: string; entityIds: string[]; through: Date }): Promise<OwnerQuestion[]> {
  const [lines, accounts] = await Promise.all([
    db.bankTransaction.findMany({
      where: { firmId: args.firmId, entityId: { in: args.entityIds }, status: "NEEDS_REVIEW", date: { lte: args.through } },
      include: { bankAccount: { include: { entity: { select: { shortName: true } } } } },
      orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
    }),
    db.account.findMany({ where: { clientId: args.clientId }, select: { code: true, name: true } }),
  ]);
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  const abs = (v: bigint) => (v < 0n ? -v : v);
  return lines
    .map((t) => ({
      date: t.date,
      entity: t.bankAccount.entity.shortName,
      bank: t.bankAccount.label,
      description: t.description,
      amount: t.amount,
      currency: t.bankAccount.currency,
      suggestion: t.suggestedCode ? `${t.suggestedCode} ${name.get(t.suggestedCode) ?? ""}`.trim() : null,
    }))
    .sort((a, b) => (abs(b.amount) > abs(a.amount) ? 1 : abs(b.amount) < abs(a.amount) ? -1 : +a.date - +b.date));
}

const NUM = '#,##0;(#,##0);"–"';
const n = (v: bigint) => (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString());

export async function ownerQuestionsWorkbook(rows: OwnerQuestion[], meta: { firm: string; client: string; through: Date }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pertanyaan");
  ws.addRow([`Pertanyaan untuk ${meta.client}`]).font = { bold: true, size: 13 };
  ws.addRow([`Transaksi yang belum jelas sampai ${formatDate(meta.through)}, dari nominal terbesar. Isi kolom Jawaban klien.`]);
  ws.addRow([`${meta.firm} · dibuat ${formatDateTime(new Date())}`]).font = { italic: true, color: { argb: "FF4B5768" } };
  ws.addRow([]);
  ws.addRow(["No", "Tanggal", "Perusahaan", "Rekening", "Keterangan bank", "Arah", "Nominal", "Mata uang", "Usulan Buku", "Pertanyaan", "Jawaban klien"]).font = { bold: true };
  rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1,
      formatDate(r.date),
      r.entity,
      r.bank,
      r.description,
      r.amount > 0n ? "Masuk" : "Keluar",
      // Whole-unit currencies (IDR) as a number to sum; others as their formatted amount, never minor units passed off as units.
      exponentOf(r.currency) === 0 ? n(r.amount < 0n ? -r.amount : r.amount) : formatMoney(r.amount < 0n ? -r.amount : r.amount, r.currency, { bare: true }),
      r.currency,
      r.suggestion ?? "",
      r.amount > 0n ? "Uang ini dari siapa dan untuk apa?" : "Uang ini ke siapa dan untuk apa?",
      "",
    ]);
    row.getCell(7).numFmt = NUM;
  });
  ws.columns.forEach((c, i) => (c.width = [5, 12, 18, 16, 50, 8, 16, 10, 28, 34, 40][i]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

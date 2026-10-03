import PDFDocument from "pdfkit";
import type { Db } from "@/lib/db";
import { formatDate, formatDateTime, periodBounds } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import type { Scope } from "@/lib/reports/ledger";
import { toUnit } from "@/lib/reports/format";
import type { NoteCell } from "@/lib/reports/notes";
import { statementSet, type SetRow, type SetStatement, type StatementSet } from "@/lib/reports/statement-set";

/**
 * The financial statements as one PDF ready to send (UC-K3): the same rows as the Excel file (`statementSet`), laid out on A4 with a
 * header on every page (entity, statement, period, unit), a DRAF line while the month isn't closed, and page numbers. Accounts beneath a
 * *Pos* stay in the Excel file; the PDF prints the lines, as a published statement does. In thousands each line rounds and each total
 * adds the printed lines, as on the page.
 */

const A4 = { width: 595.28, height: 841.89 };
const M = { left: 50, right: 50, top: 48, bottom: 56 };
const INK = "#0B1B32";
const MUTED = "#4B5768";
const FAIL = "#C4213A";
const RULE = "#C9CFD8";

const amount = (v: bigint | null) => (v === null ? "" : v === 0n ? "–" : formatRupiah(v, { bare: true, accounting: true }));

/** The values a statement prints: per line in its unit, a format total as the sum of the printed lines it names. */
export function printedValues(rows: SetRow[], unit: StatementSet["unit"]): (bigint | null)[][] {
  const byKey = new Map<string, (bigint | null)[]>();
  return rows.map((row) => {
    const values = row.terms
      ? row.values.map((_, c) => row.terms!.reduce((s, t) => s + BigInt(t.sign) * (byKey.get(t.key)?.[c] ?? 0n), 0n))
      : row.values.map((v) => (v === null ? null : toUnit(v, unit)));
    if (row.key) byKey.set(row.key, values);
    return values;
  });
}

export async function financialStatementsPdf(db: Db, scope: Scope, year: number, month: number, meta: { firm: string; title: string; draft?: string }): Promise<Buffer> {
  const set = await statementSet(db, scope, year, month);
  const asOf = formatDate(periodBounds(year, month).end);
  const doc = new PDFDocument({ size: "A4", margins: M, autoFirstPage: false, bufferPages: true, info: { Title: `Laporan keuangan ${meta.title} ${asOf}`, Author: meta.firm, Creator: "Buku" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = A4.width - M.left - M.right;
  const bottom = A4.height - M.bottom;

  // The page header follows the part being printed; every new page (one per part, and overflow) draws it.
  let header = { title: "", subtitle: "", unit: "", columns: [] as string[], colWidth: 0 };
  doc.on("pageAdded", () => drawHeader());
  function drawHeader() {
    doc.x = M.left;
    doc.y = M.top;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(meta.title, { width });
    doc.font("Helvetica-Bold").fontSize(10).text(header.title, { width });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(header.subtitle, { width });
    if (header.unit) doc.font("Helvetica-Oblique").text(header.unit, { width });
    if (meta.draft) doc.moveDown(0.3).font("Helvetica-Bold").fillColor(FAIL).text(`DRAF — ${meta.draft}`, { width });
    doc.moveDown(0.6).fillColor(INK);
    if (header.columns.length) {
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8.5);
      header.columns.forEach((c, i) => doc.text(c, colX(i), y, { width: header.colWidth, align: "right" }));
      doc.y = y + doc.heightOfString(header.columns[0] ?? "", { width: header.colWidth }) + 3;
      doc.moveTo(M.left, doc.y).lineTo(A4.width - M.right, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.y += 4;
    }
    doc.x = M.left;
  }
  const colX = (i: number) => A4.width - M.right - (header.columns.length - i) * header.colWidth;
  const startPart = (h: Partial<typeof header>) => {
    header = { title: "", subtitle: "", unit: "", columns: [], colWidth: 0, ...h };
    doc.addPage();
  };
  const ensure = (h: number) => {
    if (doc.y + h > bottom) doc.addPage();
  };

  const unitLine = `Dinyatakan dalam ${set.unit === "RIBUAN" ? "ribuan " : ""}Rupiah`;
  for (const st of set.statements) statement(st);

  function statement(st: SetStatement) {
    const n = Math.max(1, st.columns.length, ...st.rows.map((r) => r.values.length));
    const colWidth = Math.min(95, (width * 0.55) / n);
    startPart({ title: st.title, subtitle: st.subtitle, unit: unitLine, columns: st.columns, colWidth });
    const labelWidth = width - n * colWidth - 8;
    const values = printedValues(st.rows, set.unit);
    st.rows.forEach((row, i) => {
      if (row.detail) return;
      const font = row.bold ? "Helvetica-Bold" : "Helvetica";
      doc.font(font).fontSize(9);
      const indent = (row.indent ?? 0) * 10;
      const h = doc.heightOfString(row.label, { width: labelWidth - indent }) + 3;
      const total = Boolean(row.terms);
      // A section heading (a bold line without figures) gets air above it.
      if (i > 0 && row.bold && row.values.length === 0) doc.y += 5;
      ensure(h + (total ? 4 : 0));
      if (total) {
        doc.moveTo(A4.width - M.right - n * colWidth + 10, doc.y).lineTo(A4.width - M.right, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
        doc.y += 2;
      }
      const y = doc.y;
      doc.fillColor(INK).text(row.label, M.left + indent, y, { width: labelWidth - indent });
      values[i].forEach((v, c) => doc.text(amount(v), A4.width - M.right - (values[i].length - c) * colWidth, y, { width: colWidth, align: "right" }));
      doc.y = y + h;
      doc.x = M.left;
    });
  }

  const notes = set.notes;
  if (notes) {
    // CALK (in Rupiah: its tables are the registers and schedules behind the statements)
    startPart({ title: "Catatan atas Laporan Keuangan", subtitle: `Per ${asOf} dan untuk periode yang berakhir pada tanggal tersebut`, unit: "Dinyatakan dalam Rupiah" });
    const cell = (c: NoteCell) => (typeof c === "bigint" ? amount(c) : (c ?? ""));
    for (const note of notes.notes) {
      ensure(40);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(`${note.number}. ${note.title.toUpperCase()}`, M.left, doc.y, { width });
      doc.moveDown(0.3);
      for (const p of note.paragraphs) {
        doc.font("Helvetica").fontSize(9);
        ensure(doc.heightOfString(p, { width }) + 4);
        doc.text(p, M.left, doc.y, { width, align: "justify" });
        doc.moveDown(0.4);
      }
      for (const t of note.tables) table(t.columns, t.rows.map((r) => r.map(cell)), t.total?.map(cell));
      doc.moveDown(0.6);
    }

    // Pernyataan Direksi (Pemilik/Pengurus for a CV, a firm or an individual)
    startPart({ title: set.signatory.title, subtitle: `Per ${asOf}` });
    notes.directors.forEach((text, i) => {
      doc.font(i < 3 ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK);
      ensure(doc.heightOfString(text, { width }) + 6);
      doc.text(text, M.left, doc.y, { width, align: i < 3 ? "center" : "left" });
      doc.moveDown(0.5);
    });
  }

  function table(columns: string[], rows: string[][], total?: string[]) {
    const first = Math.max(width * 0.34, width - (columns.length - 1) * 90);
    const rest = columns.length > 1 ? (width - first) / (columns.length - 1) : 0;
    const x = (i: number) => (i === 0 ? M.left : M.left + first + (i - 1) * rest);
    const w = (i: number) => (i === 0 ? first - 6 : rest);
    const line = (cells: string[], bold: boolean) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c || " ", { width: w(i) }))) + 3;
      ensure(h);
      const y = doc.y;
      cells.forEach((c, i) => doc.text(c, x(i), y, { width: w(i), align: i === 0 ? "left" : "right" }));
      doc.y = y + h;
    };
    line(columns, true);
    doc.moveTo(M.left, doc.y).lineTo(A4.width - M.right, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
    doc.y += 2;
    for (const r of rows) line(r, false);
    if (total) line(total, true);
    doc.x = M.left;
    doc.moveDown(0.4);
  }

  // Page numbers and the firm on every page (the bottom margin is lifted so the footer doesn't open a page of its own).
  const range = doc.bufferedPageRange();
  const stamp = `${meta.firm} · dibuat ${formatDateTime(new Date())}`;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(stamp, M.left, A4.height - 36, { width: width / 2, lineBreak: false });
    doc.text(`Halaman ${i - range.start + 1} dari ${range.count}`, M.left + width / 2, A4.height - 36, { width: width / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

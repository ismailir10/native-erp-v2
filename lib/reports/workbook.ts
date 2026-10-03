import ExcelJS from "exceljs";
import type { Db } from "@/lib/db";
import { dateOnly, formatDate, formatDateTime, formatPeriod, periodBounds } from "@/lib/format";
import { balanceSheet, incomeStatement, type FsItem, type Scope } from "@/lib/reports/ledger";
import { balanceItems, incomeItems, loadReportFormat, renderFormat, type FormatSection } from "@/lib/reports/format";
import { cashFlow, equityChanges, otherComprehensiveIncome, EQUITY_ROWS, EQUITY_ROW_LABEL } from "@/lib/reports/statements";
import { financialNotes, type NoteCell } from "@/lib/reports/notes";
import { isMixed, scopeEntities } from "@/lib/reports/fx";
import { frameworkLabel, scopeFramework, signatoryOf, statementNames } from "@/lib/reports/framework";

/**
 * The financial statements as one Excel workbook (accounting-rules 12): Neraca, Laba Rugi (with other comprehensive income unless SAK EMKM), Perubahan
 * Ekuitas, Arus Kas, CALK and the directors' statement — each from the same functions as the page, never a second computation. Amounts are
 * Excel numbers (text beyond 2^53). Mixed-currency scopes get Neraca and Laba Rugi only, as on the page.
 */

const NUM = '#,##0;(#,##0);"–"';
/** Thousands as a display format over exact Rupiah cells (the trailing comma divides by 1.000), so every formula stays exact. */
const NUM_THOUSANDS = '#,##0,;(#,##0,);"–"';
const n = (v: bigint) => (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString());

/** `meta.draft`: why the statements are not final yet (lib/reports/status.ts); printed in red under every sheet's title. Absent = final. */
export async function financialStatementsWorkbook(db: Db, scope: Scope, year: number, month: number, meta: { firm: string; title: string; draft?: string }): Promise<Buffer> {
  const asOf = periodBounds(year, month).end;
  const lastYearEnd = dateOnly(year - 1, 12, 31);
  const priorTo = periodBounds(year - 1, month).end;
  const mixed = isMixed(await scopeEntities(db, scope.entityIds));
  // Names and the signatory follow the entities' reporting framework (reports/framework.ts); no figure does.
  const entities = await db.entity.findMany({ where: { id: { in: scope.entityIds } }, select: { kind: true, reportingFramework: true } });
  const framework = scopeFramework(entities);
  const names = statementNames(framework);
  const [bs, bsPrior, is, isPrior] = await Promise.all([
    balanceSheet(db, scope, asOf),
    balanceSheet(db, scope, lastYearEnd).catch(() => null),
    incomeStatement(db, scope, dateOnly(year, 1, 1), asOf),
    incomeStatement(db, scope, dateOnly(year - 1, 1, 1), priorTo).catch(() => null),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = meta.firm;
  // Totals are formulas; a cached 0 is not written, so Excel recalculates every formula when the file opens.
  wb.calcProperties.fullCalcOnLoad = true;
  const format = await loadReportFormat(db, scope.clientId);
  const sheet = (name: string, title: string, subtitle: string, widths: number[], unit: "RUPIAH" | "RIBUAN" = "RUPIAH") => {
    const ws = wb.addWorksheet(name);
    ws.addRow([meta.title]).font = { bold: true, size: 13 };
    ws.addRow([title]).font = { bold: true };
    ws.addRow([subtitle]);
    ws.addRow([`Dinyatakan dalam ${unit === "RIBUAN" ? "ribuan " : ""}Rupiah`]).font = { italic: true };
    ws.addRow([`${meta.firm} · dibuat ${formatDateTime(new Date())}`]).font = { italic: true, color: { argb: "FF4B5768" } };
    if (meta.draft) ws.addRow([`DRAF — ${meta.draft}`]).font = { bold: true, color: { argb: "FFC4213A" } };
    ws.addRow([]);
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
      if (i > 0) ws.getColumn(i + 1).numFmt = unit === "RIBUAN" ? NUM_THOUSANDS : NUM;
    });
    return ws;
  };
  const head = (ws: ExcelJS.Worksheet, cells: string[]) => {
    const r = ws.addRow(cells);
    r.font = { bold: true };
    r.eachCell((c) => (c.border = { bottom: { style: "thin" } }));
  };
  const line = (ws: ExcelJS.Worksheet, label: string, values: (bigint | null)[], opts: { bold?: boolean; indent?: number } = {}) => {
    const r = ws.addRow([`${" ".repeat((opts.indent ?? 0) * 2)}${label}`, ...values.map((v) => (v === null ? null : n(v)))]);
    if (opts.bold) r.font = { bold: true };
  };
  const items = (ws: ExcelJS.Worksheet, cols: (FsItem[] | undefined)[]) => {
    const keys = [...new Set(cols.flatMap((c) => (c ?? []).map((i) => i.fsLine)))];
    for (const k of keys) {
      const cells = cols.map((c) => c?.find((i) => i.fsLine === k));
      line(ws, cells.find(Boolean)!.label, cells.map((c) => c?.amount ?? 0n), { indent: 1 });
      const codes = [...new Set(cells.flatMap((c) => c?.accounts.map((a) => a.code) ?? []))];
      for (const code of codes) {
        const name = cells.flatMap((c) => c?.accounts ?? []).find((a) => a.code === code)!.name;
        line(ws, `${code} ${name}`, cells.map((c) => c?.accounts.find((a) => a.code === code)?.amount ?? 0n), { indent: 2 });
      }
    }
  };

  /**
   * A statement in the client's format (lib/reports/format.ts): each *Pos* a row of numbers with its accounts beneath, each subtotal and
   * total an Excel formula over the rows it sums (the computed value cached, so the file opens with numbers).
   */
  const formatted = (ws: ExcelJS.Worksheet, sections: FormatSection[]) => {
    const rowOf = new Map<string, number>();
    const columns = sections[0]?.items.length ?? 0;
    const letter = (c: number) => String.fromCharCode(66 + c); // B, C, …
    for (const sec of sections) {
      const keys = [...new Set(sec.items.flatMap((col) => col.map((i) => i.fsLine)))];
      if (sec.title && keys.length) line(ws, sec.title.toUpperCase(), [], { bold: true });
      for (const k of keys) {
        const cells = sec.items.map((col) => col.find((i) => i.fsLine === k));
        line(ws, cells.find(Boolean)!.label, cells.map((c) => c?.amount ?? 0n), { indent: 1 });
        rowOf.set(k, ws.lastRow!.number);
        const codes = [...new Set(cells.flatMap((c) => c?.accounts.map((a) => a.code) ?? []))];
        for (const code of codes) {
          const name = cells.flatMap((c) => c?.accounts ?? []).find((a) => a.code === code)!.name;
          line(ws, `${code} ${name}`, cells.map((c) => c?.accounts.find((a) => a.code === code)?.amount ?? 0n), { indent: 2 });
        }
      }
      const t = sec.total;
      if (!t || (t.subtotal && !keys.length)) continue;
      const r = ws.addRow([t.caps ? t.label.toUpperCase() : t.label]);
      for (let c = 0; c < columns; c++) {
        const parts = t.terms.filter((x) => rowOf.has(x.key)).map((x, i) => `${x.sign < 0 ? "-" : i ? "+" : ""}${letter(c)}${rowOf.get(x.key)}`);
        const value = n(t.values[c]);
        r.getCell(c + 2).value = parts.length ? { formula: parts.join(""), result: typeof value === "number" ? value : Number(value) } : value;
      }
      if (t.strong || t.caps) r.font = { bold: true };
      rowOf.set(t.key, r.number);
    }
  };

  // Neraca
  const cur = formatDate(asOf);
  const old = formatDate(lastYearEnd);
  const nr = sheet("Neraca", names.position, `Per ${cur}${bsPrior ? ` dan ${old}` : ""}`, [56, 20, 20], format.unit);
  head(nr, ["", cur, ...(bsPrior ? [old] : [])]);
  formatted(nr, renderFormat(format.neraca, [bs, ...(bsPrior ? [bsPrior] : [])].map(balanceItems)));

  // Laba Rugi (with other comprehensive income)
  const colCur = `1 Jan – ${cur}`;
  const colOld = `1 Jan – ${formatDate(priorTo)}`;
  const lr = sheet("Laba Rugi", names.income, `Untuk periode 1 Januari – ${cur}${isPrior ? `, dibandingkan periode yang sama ${year - 1}` : ""}`, [56, 20, 20], format.unit);
  head(lr, ["", colCur, ...(isPrior ? [colOld] : [])]);
  formatted(lr, renderFormat(format.labaRugi, [is, ...(isPrior ? [isPrior] : [])].map(incomeItems)));
  const pl = <T,>(a: T, pick: () => T) => [a, ...(isPrior ? [pick()] : [])];
  if (!mixed && framework !== "SAK_EMKM") {
    const [oci, ociPrior] = await Promise.all([otherComprehensiveIncome(db, scope, dateOnly(year, 1, 1), asOf), otherComprehensiveIncome(db, scope, dateOnly(year - 1, 1, 1), priorTo)]);
    line(lr, "Penghasilan komprehensif lain", [], { bold: true });
    items(lr, pl(oci.items, () => ociPrior.items));
    line(lr, "Total penghasilan komprehensif", pl(is.totals.netProfit + oci.total, () => isPrior!.totals.netProfit + ociPrior.total), { bold: true });
  }
  if (mixed) return Buffer.from(await wb.xlsx.writeBuffer());

  // Perubahan Ekuitas
  const eq = await equityChanges(db, scope, asOf);
  const pe = sheet("Perubahan Ekuitas", names.equity, `Untuk periode 1 Januari – ${cur}`, [40, ...eq.columns.map(() => 20), 20]);
  head(pe, ["", ...eq.columns.map((c) => c.label), "Jumlah"]);
  for (const r of EQUITY_ROWS) {
    if (r !== "opening" && r !== "closing" && eq.totals[r] === 0n) continue;
    const label = r === "opening" ? `Saldo ${formatDate(eq.openedAt)}` : r === "closing" ? `Saldo ${cur}` : frameworkLabel(framework, EQUITY_ROW_LABEL[r]);
    line(pe, label, [...eq.values[r], eq.totals[r]], { bold: r === "opening" || r === "closing" });
  }

  // Arus Kas
  const cf = await cashFlow(db, scope, asOf);
  const ak = sheet("Arus Kas", names.cashFlow, `Untuk periode 1 Januari – ${cur}`, [56, 20]);
  line(ak, "ARUS KAS DARI AKTIVITAS OPERASI", [], { bold: true });
  line(ak, "Laba bersih", [cf.netProfit], { indent: 1 });
  for (const i of cf.operating) line(ak, `${frameworkLabel(framework, i.label)} (${i.codes.join(", ")})`, [i.amount], { indent: 1 });
  line(ak, "Kas bersih dari aktivitas operasi", [cf.totals.OPERATING], { bold: true });
  line(ak, "ARUS KAS DARI AKTIVITAS INVESTASI", [], { bold: true });
  for (const i of cf.investing) line(ak, `${frameworkLabel(framework, i.label)} (${i.codes.join(", ")})`, [i.amount], { indent: 1 });
  line(ak, "Kas bersih dari aktivitas investasi", [cf.totals.INVESTING], { bold: true });
  line(ak, "ARUS KAS DARI AKTIVITAS PENDANAAN", [], { bold: true });
  for (const i of cf.financing) line(ak, `${frameworkLabel(framework, i.label)} (${i.codes.join(", ")})`, [i.amount], { indent: 1 });
  line(ak, "Kas bersih dari aktivitas pendanaan", [cf.totals.FINANCING], { bold: true });
  line(ak, "Kenaikan (penurunan) bersih kas dan setara kas", [cf.net], { bold: true });
  line(ak, `Kas dan setara kas ${formatDate(cf.openedAt)}`, [cf.openingCash]);
  line(ak, `Kas dan setara kas ${cur}`, [cf.closingCash], { bold: true });

  // CALK
  const notes = await financialNotes(db, scope, year, month);
  const ck = sheet("CALK", "Catatan atas Laporan Keuangan", `Per ${cur} dan untuk periode yang berakhir pada tanggal tersebut (draf)`, [60, 20, 20, 20, 20]);
  const cell = (c: NoteCell) => (typeof c === "bigint" ? n(c) : c);
  for (const note of notes.notes) {
    ck.addRow([`${note.number}. ${note.title.toUpperCase()}`]).font = { bold: true };
    for (const p of note.paragraphs) {
      const r = ck.addRow([p]);
      r.alignment = { wrapText: true, vertical: "top" };
      ck.mergeCells(r.number, 1, r.number, 5);
    }
    for (const t of note.tables) {
      head(ck, t.columns);
      for (const row of t.rows) ck.addRow(row.map(cell));
      if (t.total) ck.addRow(t.total.map(cell)).font = { bold: true };
    }
    ck.addRow([]);
  }

  // Pernyataan Direksi (Pemilik/Pengurus for a CV, a firm or an individual)
  const pd = wb.addWorksheet(signatoryOf(entities).sheet);
  pd.getColumn(1).width = 100;
  notes.directors.forEach((text, i) => {
    const r = pd.addRow([text]);
    r.alignment = { wrapText: true, horizontal: i < 3 ? "center" : "left" };
    if (i < 3) r.font = { bold: true };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const statementsFileName = (label: string, year: number, month: number) => `laporan-keuangan-${label.replace(/[^\w-]+/g, "_")}-${formatPeriod(year, month).replace(/\s+/g, "-")}.xlsx`;

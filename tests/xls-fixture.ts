import * as XLSX from "xlsx";

/**
 * Legacy-Excel fixtures for parser tests, built with SheetJS (real client .xls files are never committed).
 * A cell is a string, a number, null, or `{ date: "YYYY-MM-DD" }` — written as an Excel serial with a date format, the way
 * Excel stores it (no JS Date, so the fixture is the same in every time zone).
 */
export type FixtureCell = string | number | null | { date: string };
export type FixtureSheet = { name: string; rows: FixtureCell[][] };

const EPOCH = Date.UTC(1899, 11, 30);

function toCell(c: FixtureCell): XLSX.CellObject | null {
  if (c === null) return null;
  if (typeof c === "number") return { t: "n", v: c };
  if (typeof c === "string") return { t: "s", v: c };
  return { t: "n", v: (Date.parse(`${c.date}T00:00:00Z`) - EPOCH) / 86_400_000, z: "dd/mm/yyyy" };
}

export function workbook(sheets: FixtureSheet[], bookType: XLSX.BookType): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxC = 0;
    s.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        const cell = toCell(v);
        if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell;
        maxC = Math.max(maxC, c);
      }),
    );
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: maxC } });
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType }));
}

/** An HTML table saved with an .xls name — what several Indonesian internet-banking exports are. */
export function htmlXls(rows: string[][]): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(`<html><head><meta charset="utf-8"></head><body><table>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></body></html>`);
}

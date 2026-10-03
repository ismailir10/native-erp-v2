import ExcelJS from "exceljs";
import Papa from "papaparse";
import { asXlsx, sniffFile } from "@/lib/import/workbook";
import { ParseError } from "@/lib/import/types";
import { centsToMinor, parseCents } from "@/lib/money";

/**
 * A client's aging file (use-case UC-A1): one row per counterparty with its total and age buckets, from whatever its system exports.
 * The header block can span several rows (title rows first); a counterparty column and a total column are required; buckets are read
 * by their words. Excel's habit of turning a "1-30" header into a date (30 January) or its serial number is undone. Amounts with sen
 * are rounded to whole Rupiah per row (noted). Total and subtotal rows are skipped; credit rows (advances, overpayments) are kept.
 */
export const AGING_BUCKETS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_120", "OVER_90", "OVER_120"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  NOT_DUE: "Belum jatuh tempo",
  D1_30: "1–30",
  D31_60: "31–60",
  D61_90: "61–90",
  D91_120: "91–120",
  OVER_90: "> 90",
  OVER_120: "> 120",
};

export type AgingRow = { counterparty: string; total: bigint; buckets: Partial<Record<AgingBucket, bigint>>; sourceRef: string; rounded: boolean };
export type AgingRead = { sheet: string; headerRow: number; rows: AgingRow[]; buckets: AgingBucket[]; notes: string[] };

type Cell = string | number | Date | null;

const COUNTERPARTY = /\b(nama|customer|pelanggan|supplier|vendor|pemasok|debitur|kreditur|name|lawan|mitra|rekanan|account name)\b/i;
const TOTAL = /\b(total|jumlah|saldo|balance|outstanding|sisa)\b/i;
const SKIP_ROW = /^\s*(sub\s*-?\s*total|grand\s*total|total|jumlah|saldo akhir)\b/i;

/** The bucket a header names, or null. A date (30 Jan) or an Excel serial for 30 Jan is the "1-30" Excel turned into a date. */
function bucketOf(label: string, raw: Cell[]): AgingBucket | null {
  for (const cell of raw) {
    // A serial can also arrive as text (a CSV saved from Excel).
    const v = typeof cell === "string" && /^\s*\d{5}\s*$/.test(cell) ? Number(cell) : cell;
    const d = v instanceof Date ? v : typeof v === "number" && v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + v * 86_400_000) : null;
    if (d && d.getUTCMonth() === 0 && d.getUTCDate() === 30) return "D1_30";
  }
  const t = label.toLowerCase().replace(/\s+/g, " ");
  if (/belum (jatuh tempo|jt)|not (yet )?due|\bcurrent\b|\blancar\b/.test(t)) return "NOT_DUE";
  if (/(^|[^\d])1\s*[-–s/d]+\s*30\b|\b0\s*[-–]\s*30\b/.test(t)) return "D1_30";
  if (/\b31\s*[-–s/d]+\s*60\b/.test(t)) return "D31_60";
  if (/\b61\s*[-–s/d]+\s*90\b/.test(t)) return "D61_90";
  if (/\b91\s*[-–s/d]+\s*120\b/.test(t)) return "D91_120";
  if (/(>|lebih dari|di ?atas|over|above)\s*120|120\s*\+/.test(t)) return "OVER_120";
  if (/(>|lebih dari|di ?atas|over|above)\s*90|90\s*\+/.test(t)) return "OVER_90";
  return null;
}

const text = (v: Cell) => (v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();

function cellValue(c: ExcelJS.Cell): Cell {
  const v = c.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object" && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return r instanceof Date || typeof r === "number" || typeof r === "string" ? r : null;
  }
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (typeof v === "boolean") return String(v);
  return String(c.text ?? "");
}

/** The file as grids (one per sheet), whatever its kind. */
async function grids(data: Buffer): Promise<{ name: string; rows: Cell[][] }[]> {
  if (sniffFile(data) === "TEXT") {
    const body = data.toString("utf8").replace(/^\uFEFF/, "");
    // The delimiter by count in the first lines (Papa's guess fails on a two-column file); Indonesian amounts keep commas inside.
    const head = body.split(/\r?\n/).slice(0, 15).join("\n");
    const delimiter = [";", "\t", ","].map((d) => [d, head.split(d).length - 1] as const).sort((a, b) => b[1] - a[1])[0][0];
    const parsed = Papa.parse<string[]>(body, { skipEmptyLines: false, delimiter });
    return [{ name: "CSV", rows: parsed.data.map((r) => r.map((c) => (c === "" ? null : c))) }];
  }
  const xlsx = asXlsx(data);
  if (!xlsx) throw new ParseError("File ini bukan Excel atau CSV. Unggah aging dalam format .xlsx, .xls atau .csv.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const cells: Cell[] = [];
      r.eachCell({ includeEmpty: true }, (c, col) => (cells[col - 1] = cellValue(c)));
      rows[n - 1] = cells;
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

/** An amount cell in minor units (whole Rupiah) and whether it had sen. Blank and "-" are zero; "1.000-" and "1.000 CR" are credits. */
function amount(v: Cell): { value: bigint; rounded: boolean } {
  if (v === null || v instanceof Date) return { value: 0n, rounded: false };
  let s = typeof v === "number" ? v : v.trim();
  let credit = false;
  if (typeof s === "string") {
    if (/(?<=[\d\s])(cr|kr)\.?$/i.test(s)) [credit, s] = [true, s.replace(/(cr|kr)\.?$/i, "")];
    else s = s.replace(/(?<=[\d\s])(dr|db)\.?$/i, "");
    s = s.replace(/[^\d.,()\-+]/g, "");
    if (/\d-$/.test(s)) [credit, s] = [!credit, s.slice(0, -1)];
  }
  const cents = parseCents(s === "" ? "0" : s);
  const value = centsToMinor(cents, "IDR");
  return { value: credit ? -value : value, rounded: cents % 100n !== 0n };
}

const NAME = /\b(nama|name)\b/i;
const CODE = /\b(kode|code|id|no|nomor|npwp)\b\.?/i;
/** The grand total: what follows it is a footer (GL balance, difference, signatures), not counterparties. */
const GRAND = /^\s*(grand\s*total|total(\s*(keseluruhan|seluruhnya|piutang|utang))?|jumlah(\s*total)?)\s*:?\s*$/i;

/** A merged title spanning several columns: ExcelJS repeats its text in each cell, so a neighbour with the same text gives it away. */
const isGroupTitle = (row: Cell[], c: number) => {
  const t = text(row[c] ?? null);
  return !!t && (text(row[c - 1] ?? null) === t || text(row[c + 1] ?? null) === t);
};

type Sheet = { name: string; rows: Cell[][] };

/** One sheet's aging, or null when it has no header block; `missing` collects what the closest header lacked. */
function readSheet(sheet: Sheet, missing: Set<string>, empty: string[]): AgingRead | null {
  for (let r = 0; r < Math.min(15, sheet.rows.length); r++) {
    const own = (sheet.rows[r] ?? []).map(text);
    if (!own.some(Boolean)) continue;
    // A column's label: this row's text with up to two rows above it (headers spread over rows 5–7).
    const width = Math.max(...sheet.rows.slice(Math.max(0, r - 2), r + 1).map((x) => x.length), 0);
    const stacked = Array.from({ length: width }, (_, c) => sheet.rows.slice(Math.max(0, r - 2), r + 1).map((x) => text(x[c] ?? null)).filter(Boolean).join(" "));
    // The name column: this row's own "Nama …" first, never a code or number column; the stacked label only when nothing else fits.
    const ownMatch = (re: RegExp) => own.findIndex((l, c) => re.test(l) && !CODE.test(l) && !isGroupTitle(sheet.rows[r], c));
    let nameCol = ownMatch(NAME);
    if (nameCol < 0) nameCol = ownMatch(COUNTERPARTY);
    if (nameCol < 0) nameCol = stacked.findIndex((l) => COUNTERPARTY.test(l) && !CODE.test(l));
    if (nameCol < 0) {
      if (stacked.some((l) => TOTAL.test(l))) missing.add("kolom nama pelanggan/pemasok");
      continue;
    }
    // The block may go on below (bucket names under a merged "Umur" title): rows with text but no name are header too.
    let end = r;
    while (end + 1 < sheet.rows.length) {
      const next = sheet.rows[end + 1] ?? [];
      const hasText = next.some((v, i) => i !== nameCol && typeof v === "string" && v.trim() && !/^[\d.,()\-\s]+$/.test(v));
      if (text(next[nameCol] ?? null) || !hasText) break;
      end++;
    }
    const block = sheet.rows.slice(Math.max(0, r - 2), end + 1);
    const cols = Array.from({ length: Math.max(width, ...block.map((x) => x.length)) }, (_, c) => block.map((x) => x[c] ?? null));
    const header = cols.map((cells) => cells.map(text).filter(Boolean).join(" "));
    const bucketCols = cols.map((cells, i) => (i === nameCol ? null : bucketOf(header[i], cells)));
    // The total column: the last non-bucket column labelled total/saldo, a merged group title ("Total Umur Piutang") not counting.
    const plain = cols.map((_, c) => block.map((x) => (isGroupTitle(x, c) ? "" : text(x[c] ?? null))).filter(Boolean).join(" "));
    const totalCol = plain.map((l, i) => (i !== nameCol && !bucketCols[i] && TOTAL.test(l) ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    if (totalCol < 0) {
      missing.add("kolom total/saldo");
      continue;
    }
    const found = [...new Set(bucketCols.filter((b): b is AgingBucket => b !== null))];
    // "> 90" alongside "91–120" / "> 120" overlaps: the buckets then don't add up to the total by design.
    const additive = !(found.includes("OVER_90") && (found.includes("D91_120") || found.includes("OVER_120")));
    const rows: AgingRow[] = [];
    let roundedRows = 0;
    let fromBuckets = 0;
    let footer = 0;
    let afterGrand = false;
    const unequal: string[] = [];
    for (let k = end + 1; k < sheet.rows.length; k++) {
      const line = sheet.rows[k] ?? [];
      const name = text(line[nameCol] ?? null);
      if (!name) continue;
      if (GRAND.test(name)) {
        afterGrand = true;
        continue;
      }
      if (SKIP_ROW.test(name)) continue;
      let rounded = false;
      let total: bigint;
      try {
        const t = amount(line[totalCol] ?? null);
        total = t.value;
        rounded ||= t.rounded;
      } catch {
        throw new ParseError(`Baris ${k + 1} (${name}): total "${text(line[totalCol] ?? null)}" bukan angka.`);
      }
      const buckets: Partial<Record<AgingBucket, bigint>> = {};
      bucketCols.forEach((b, i) => {
        if (!b) return;
        try {
          const a = amount(line[i] ?? null);
          buckets[b] = (buckets[b] ?? 0n) + a.value;
          rounded ||= a.rounded;
        } catch {
          throw new ParseError(`Baris ${k + 1} (${name}): kolom ${header[i]} "${text(line[i] ?? null)}" bukan angka.`);
        }
      });
      const inBuckets = Object.values(buckets).reduce((s, v) => s + (v ?? 0n), 0n);
      const hasBuckets = Object.values(buckets).some((v) => v);
      // Below the grand total only rows that still carry an age split are counterparties (a footer "Saldo menurut GL" has none).
      if (afterGrand && !hasBuckets) {
        if (total !== 0n) footer++;
        continue;
      }
      if (total === 0n && !hasBuckets) continue;
      // A formula total saved without its result reads blank: the buckets stand in for it.
      if (text(line[totalCol] ?? null) === "" && hasBuckets && additive) {
        total = inBuckets;
        fromBuckets++;
      } else if (found.length && additive && hasBuckets && inBuckets !== total) unequal.push(`${sheet.name}!${k + 1}`);
      if (rounded) roundedRows++;
      rows.push({ counterparty: name.replace(/\s+/g, " "), total, buckets, sourceRef: `${sheet.name}!${k + 1}`, rounded });
    }
    if (!rows.length) {
      empty.push(`Lembar ${sheet.name} punya judul kolom aging tetapi tidak ada baris pelanggan/pemasok di bawahnya.`);
      return null;
    }
    const notes: string[] = [];
    if (roundedRows) notes.push(`${roundedRows} baris memakai sen dan dibulatkan ke Rupiah penuh.`);
    if (fromBuckets) notes.push(`${fromBuckets} baris tanpa nilai total (rumus tanpa hasil); dipakai jumlah kolom umurnya.`);
    if (unequal.length) notes.push(`${unequal.length} baris: total tidak sama dengan jumlah kolom umur (mis. ${unequal.slice(0, 3).join(", ")}). Total yang dipakai.`);
    if (footer) notes.push(`${footer} baris di bawah Grand Total dilewati (bukan pelanggan/pemasok).`);
    return { sheet: sheet.name, headerRow: end + 1, rows, buckets: AGING_BUCKETS.filter((b) => found.includes(b)), notes };
  }
  return null;
}

/** Reads the aging: of the sheets with an aging header block, the one with age columns and the most rows (a summary sheet loses). */
export async function readAging(data: Buffer): Promise<AgingRead> {
  const sheets = await grids(data);
  const missing = new Set<string>();
  const empty: string[] = [];
  const reads = sheets.map((s) => readSheet(s, missing, empty)).filter((x): x is AgingRead => x !== null);
  const best = reads.sort((a, b) => Number(b.buckets.length > 0) - Number(a.buckets.length > 0) || b.rows.length - a.rows.length)[0];
  if (best) {
    if (reads.length > 1) best.notes.unshift(`Dibaca dari lembar ${best.sheet} (yang punya kolom umur dan baris terbanyak).`);
    return best;
  }
  if (empty.length) throw new ParseError(empty[0]);
  throw new ParseError(
    `Judul kolom aging tidak ditemukan di 15 baris pertama${missing.size ? ` (tidak ada ${[...missing].join(" dan ")})` : ""}. Pastikan ada kolom nama pelanggan/pemasok dan kolom total.`,
  );
}

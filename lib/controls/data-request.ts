import { formatPeriod, monthName } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { CompletenessRow } from "@/lib/controls/completeness";

/**
 * The request to the client for what the books still miss (I1a, ADR 0014 Sumber), written from the completeness grid: one numbered
 * line per account (missing months as ranges), one per month whose statement doesn't hand over or breaks inside, one for the ledger
 * export. Plain Bahasa for WhatsApp or e-mail; the accountant sends it. Null when nothing is missing.
 */
export function dataRequest(input: { clientName: string; firmName: string; period: { year: number; month: number }; rows: CompletenessRow[] }): string | null {
  const lines: string[] = [];
  for (const r of input.rows) {
    const what = r.kind === "ledger" ? "Ekspor buku besar dari sistem akuntansi" : `Rekening koran ${r.label} a.n. ${r.entity}`;
    const missing = monthRanges(r.cells.filter((c) => c.state === "missing"));
    if (missing.length) lines.push(`${what}: ${joinList(missing)}.`);
    for (const c of r.cells.filter((x) => x.state === "broken")) {
      const month = formatPeriod(c.year, c.month);
      lines.push(
        c.diff !== null
          ? `${what}, ${month}: saldo awalnya tidak sama dengan saldo akhir bulan sebelumnya (selisih ${formatMoney(c.diff < 0n ? -c.diff : c.diff, r.currency)}). Mohon kirim file lengkap, termasuk halaman yang mungkin terlewat.`
          : `${what}, ${month}: saldo berjalan di file tidak nyambung. Mohon kirim file asli yang lengkap.`,
      );
    }
  }
  if (!lines.length) return null;
  return [
    "Halo Bapak/Ibu,",
    "",
    `Untuk pembukuan ${input.clientName} sampai ${formatPeriod(input.period.year, input.period.month)}, kami masih memerlukan:`,
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    "",
    "Bila bisa, mohon kirim PDF e-statement atau file CSV/Excel dari internet banking (bukan foto atau tangkapan layar), supaya angkanya bisa langsung dicek.",
    "",
    "Terima kasih.",
    input.firmName,
  ].join("\n");
}

/** Consecutive months as ranges: "April–Mei 2026", "Desember 2025–Januari 2026", "Juli 2026". */
export function monthRanges(cells: { year: number; month: number }[]): string[] {
  const keys = [...new Set(cells.map((c) => c.year * 12 + c.month - 1))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < keys.length; ) {
    let j = i;
    while (j + 1 < keys.length && keys[j + 1] === keys[j] + 1) j++;
    const [a, b] = [keys[i], keys[j]];
    const [ay, am, by, bm] = [Math.floor(a / 12), (a % 12) + 1, Math.floor(b / 12), (b % 12) + 1];
    out.push(a === b ? formatPeriod(ay, am) : ay === by ? `${monthName(am)}–${formatPeriod(by, bm)}` : `${formatPeriod(ay, am)}–${formatPeriod(by, bm)}`);
    i = j + 1;
  }
  return out;
}

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} dan ${xs[xs.length - 1]}`);

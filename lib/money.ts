/**
 * Money = integer Rupiah as bigint. Never route amounts through Number.
 * See .claude/skills/accounting-rules/SKILL.md §Money.
 */

/** Effective PPN rate since 2025: 12% × DPP 11/12 = 11% of the gross-up base. */
export const PPN_EFFECTIVE_PERCENT = 11n;

/**
 * Parse a bank amount string into integer Rupiah. Handles "1.234.567,00" (id-ID),
 * "1,234,567.00" (en), "1500000.00", "-2.500", "(2.500)". Sen are rounded half-up.
 */
export function parseRupiah(input: string | number | bigint | null | undefined): bigint {
  if (input === null || input === undefined) return 0n;
  if (typeof input === "bigint") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Nominal tidak valid: ${input}`);
    return parseRupiah(input.toFixed(2));
  }
  let s = input.trim().replace(/\s|Rp\.?|IDR/gi, "");
  if (s === "" || s === "-") return 0n;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let frac = "";
  const decimalSep = detectDecimalSeparator(s, lastDot, lastComma);
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) throw new Error(`Nominal tidak valid: "${input}"`);
  let value = BigInt(intPart || "0");
  if (frac.length > 0 && Number(frac[0]) >= 5) value += 1n;
  return negative ? -value : value;
}

function detectDecimalSeparator(s: string, lastDot: number, lastComma: number): "." | "," | null {
  if (lastDot === -1 && lastComma === -1) return null;
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? "." : ",";
  const sep = lastDot !== -1 ? "." : ",";
  const idx = lastDot !== -1 ? lastDot : lastComma;
  const occurrences = s.split(sep).length - 1;
  const digitsAfter = s.length - idx - 1;
  // "1.500.000" (thousands) vs "1500.50" / "1500,5" (decimal)
  if (occurrences > 1) return null;
  return digitsAfter === 3 ? null : sep;
}

const nf = new Intl.NumberFormat("id-ID");

/** "Rp 1.234.567" ; negatives as "(Rp 1.234.567)" accounting style when `accounting`. */
export function formatRupiah(value: bigint, opts: { accounting?: boolean; bare?: boolean } = {}): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const body = nf.format(abs);
  const withSymbol = opts.bare ? body : `Rp ${body}`;
  if (!neg) return withSymbol;
  return opts.accounting ? `(${withSymbol})` : `-${withSymbol}`;
}

/** Compact for charts/KPIs: "Rp 1,2 M", "Rp 350 jt". */
export function formatRupiahCompact(value: bigint): string {
  const n = Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (abs >= 1e12) return `${sign}Rp ${fmt(abs / 1e12)} T`;
  if (abs >= 1e9) return `${sign}Rp ${fmt(abs / 1e9)} M`;
  if (abs >= 1e6) return `${sign}Rp ${fmt(abs / 1e6)} jt`;
  return `${sign}Rp ${nf.format(abs)}`;
}

/** Split a PPN-inclusive gross into DPP + PPN (estimate). dpp + ppn === gross always. */
export function splitPpn(gross: bigint): { dpp: bigint; ppn: bigint } {
  const neg = gross < 0n;
  const g = neg ? -gross : gross;
  const hundred = 100n + PPN_EFFECTIVE_PERCENT;
  const dpp = (g * 100n + hundred / 2n) / hundred;
  const ppn = g - dpp;
  return neg ? { dpp: -dpp, ppn: -ppn } : { dpp, ppn };
}

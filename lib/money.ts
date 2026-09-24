import { CURRENCIES, divRound, exponentOf } from "@/lib/fx/currency";

/**
 * Money = bigint minor units of a currency (IDR: whole Rupiah). Never route amounts through Number.
 * See .claude/skills/accounting-rules/SKILL.md §Money (rules 6, 6a, 6b).
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

/**
 * Parse an amount to **sen** (2 decimals, bigint), whatever its currency: "1.234.567,89", "1,234,567.89", "(2.500)",
 * or a spreadsheet float such as 93375132.07000001 (float noise beyond 2 decimals is rounded half-up to sen first).
 * Throws on anything that isn't a number — callers turn that into a BLOCK check.
 */
export function parseCents(input: string | number | bigint | null | undefined): bigint {
  if (input === null || input === undefined) return 0n;
  if (typeof input === "bigint") return input * 100n;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Nominal tidak valid: ${input}`);
    return parseCents(input.toFixed(6));
  }
  let s = input.trim().replace(/\s|Rp\.?|IDR|SGD|USD/gi, "");
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
  const decimalSep = detectDecimalSeparator(s, s.lastIndexOf("."), s.lastIndexOf(","));
  let intPart = s;
  let frac = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart === "" && frac === "")) throw new Error(`Nominal tidak valid: "${input}"`);
  const scaled = BigInt((intPart || "0") + frac.padEnd(Math.max(frac.length, 2), "0"));
  const value = frac.length > 2 ? divRound(scaled, 10n ** BigInt(frac.length - 2)) : scaled;
  return negative ? -value : value;
}

/** Sen → minor units of `currency` (IDR/JPY: whole units, rounded half away from zero). */
export function centsToMinor(cents: bigint, currency: string): bigint {
  const e = exponentOf(currency);
  if (e === 2) return cents;
  if (e > 2) return cents * 10n ** BigInt(e - 2);
  return divRound(cents, 10n ** BigInt(2 - e));
}

/** Parse straight to minor units of `currency`. */
export function parseMinor(input: string | number | bigint | null | undefined, currency: string): bigint {
  return centsToMinor(parseCents(input), currency);
}

/**
 * Rule 6a: round each signed sen amount to the currency's minor unit and report the residue that one line on
 * 7190 Selisih Pembulatan must carry so the rounded entry sums to the rounded total. Nothing is spread silently.
 * Returns `rounded[i]` (signed minor units) and `rounding` (signed, debit-positive) with Σrounded + rounding = round(Σcents).
 */
export function roundEntry(cents: bigint[], currency: string): { rounded: bigint[]; rounding: bigint; total: bigint } {
  const rounded = cents.map((c) => centsToMinor(c, currency));
  const total = centsToMinor(cents.reduce((s, c) => s + c, 0n), currency);
  const rounding = total - rounded.reduce((s, r) => s + r, 0n);
  return { rounded, rounding, total };
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

/**
 * Format minor units of any currency, id-ID style: "Rp 1.234.567", "S$ 196.500,00", "(US$ 44,97)" with `accounting`.
 * IDR goes through formatRupiah so existing output is unchanged.
 */
export function formatMoney(value: bigint, currency: string, opts: { accounting?: boolean; bare?: boolean } = {}): string {
  if (currency === "IDR") return formatRupiah(value, opts);
  const e = exponentOf(currency);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const unit = 10n ** BigInt(e);
  const int = nf.format(abs / unit);
  const body = e ? `${int},${(abs % unit).toString().padStart(e, "0")}` : int;
  const symbol = CURRENCIES[currency as keyof typeof CURRENCIES].symbol;
  const withSymbol = opts.bare ? body : `${symbol} ${body}`;
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

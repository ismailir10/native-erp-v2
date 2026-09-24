/**
 * Currency registry + exact rate math (ADR 0006, accounting-rules §6/6b).
 * Amounts are bigint minor units of their currency; rates are decimal strings ("1.31", "11245.5").
 * No floating point anywhere: a rate is parsed into (integer numerator, decimal scale).
 */

export const CURRENCIES = {
  IDR: { exponent: 0, name: "Rupiah", symbol: "Rp" },
  USD: { exponent: 2, name: "Dolar AS", symbol: "US$" },
  SGD: { exponent: 2, name: "Dolar Singapura", symbol: "S$" },
  JPY: { exponent: 0, name: "Yen Jepang", symbol: "¥" },
  EUR: { exponent: 2, name: "Euro", symbol: "€" },
  AUD: { exponent: 2, name: "Dolar Australia", symbol: "A$" },
  CNY: { exponent: 2, name: "Yuan Tiongkok", symbol: "CN¥" },
  HKD: { exponent: 2, name: "Dolar Hong Kong", symbol: "HK$" },
  MYR: { exponent: 2, name: "Ringgit Malaysia", symbol: "RM" },
  GBP: { exponent: 2, name: "Pound Sterling", symbol: "£" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const PRESENTATION_CURRENCY: CurrencyCode = "IDR";

export function isCurrency(code: string | null | undefined): code is CurrencyCode {
  return !!code && Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function exponentOf(code: string): number {
  if (!isCurrency(code)) throw new Error(`Mata uang ${code} belum didukung`);
  return CURRENCIES[code].exponent;
}

export type ParsedRate = { num: bigint; scale: number };

/** Parse a positive decimal rate. Accepts "1.31", "11245.50", "11,245.50" (comma thousands) — never a float. */
export function parseRate(input: string): ParsedRate {
  const s = input.trim().replace(/\s/g, "");
  let t = s;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`Kurs tidak valid: "${input}"`);
  const [int, frac = ""] = t.split(".");
  const num = BigInt(int + frac);
  if (num === 0n) throw new Error(`Kurs tidak boleh nol: "${input}"`);
  return { num, scale: frac.length };
}

/** Canonical decimal string of a rate ("1.3100" → "1.31"). */
export function formatRate(rate: ParsedRate | string): string {
  const r = typeof rate === "string" ? parseRate(rate) : rate;
  const digits = r.num.toString().padStart(r.scale + 1, "0");
  if (r.scale === 0) return digits;
  const int = digits.slice(0, digits.length - r.scale);
  const frac = digits.slice(digits.length - r.scale).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("divRound: pembagi harus positif");
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= d) return n < 0n ? q - 1n : q + 1n;
  return q;
}

/**
 * Convert minor units of `from` into minor units of `to` at `rate` (= units of `to` per 1 unit of `from`).
 * Rounded half away from zero to the target's minor unit.
 */
export function convertMinor(amount: bigint, from: string, to: string, rate: string | ParsedRate): bigint {
  const r = typeof rate === "string" ? parseRate(rate) : rate;
  const eFrom = exponentOf(from);
  const eTo = exponentOf(to);
  // amount / 10^eFrom * (num / 10^scale) * 10^eTo
  const numer = amount * r.num * 10n ** BigInt(eTo);
  const denom = 10n ** BigInt(r.scale + eFrom);
  return divRound(numer, denom);
}

/** Inverse of a rate as a decimal string with `digits` decimals (for quoting IDR per SGD vs SGD per IDR). */
export function invertRate(rate: string, digits = 10): string {
  const r = parseRate(rate);
  const q = divRound(10n ** BigInt(r.scale + digits), r.num);
  return formatRate({ num: q, scale: digits });
}

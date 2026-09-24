import { convertMinor, exponentOf, isCurrency } from "@/lib/fx/currency";
import { centsToMinor, formatMoney, roundEntry } from "@/lib/money";
import { formatDate } from "@/lib/format";
import type { LedgerRow, NeracaRow, NeracaTotal } from "@/lib/ledger-import/types";

/**
 * Source checks + posting plan (accounting-rules §15a). Pure: no DB, no AI.
 * The plan is exactly what post.ts will post, so every check describes the real outcome.
 */

export type Severity = "BLOCK" | "REVIEW" | "INFO";
export type Check = {
  severity: Severity;
  code: string;
  message: string;
  refs: string[];
  entityKey?: string;
  date?: Date;
  /** Functional minor units of the entity, when the check is about an amount. */
  amount?: bigint;
  /** BLOCK checks the accountant may accept (unbalanced group → difference to 1999). */
  acceptable?: boolean;
  groupKey?: string;
};

export type EntityInfo = { entityId: string; name: string; currency: string };
export type CurrencyMode = "FUNCTIONAL" | "CONVERT";

export type PlanLine = {
  ref: string;
  code: string;
  name: string;
  /** Signed functional minor units, debit-positive. */
  amount: bigint;
  fx: { currency: string; amount: bigint; rate: string } | null;
  memo: string | null;
};
export type PlanEntry = {
  key: string;
  entityKey: string;
  date: Date;
  ref: string;
  memo: string;
  lines: PlanLine[];
  /** Σ lines before rounding residue; ≠ 0 = the source group doesn't balance (goes to 1999 only if accepted). */
  imbalance: bigint;
  /** 7190 residue (debit-positive) so rounded lines + residue = rounded total. */
  rounding: bigint;
};

export type Plan = { entries: PlanEntry[]; checks: Check[]; accounts: Map<string, { entityKey: string; code: string; name: string; previousNames: string[]; balance: bigint; currency: string | null }> };

type RateFor = (currency: string, functional: string, date: Date) => string | null;

const MAX_REFS = 50;
const cap = (refs: string[]) => (refs.length > MAX_REFS ? [...refs.slice(0, MAX_REFS), `… +${refs.length - MAX_REFS} baris`] : refs);
export const accountKey = (entityKey: string, code: string) => `${entityKey}|${code}`;

/** Compress "S!5, S!6, S!7" → "S!5-7" for entry refs. */
export function rangeRef(refs: string[]): string {
  if (!refs.length) return "";
  const [sheet] = refs[0].split("!");
  const nums = refs.map((r) => Number(r.split("!")[1])).sort((a, b) => a - b);
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (const n of [...nums.slice(1), NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return `${sheet}!${parts.join(",")}`.slice(0, 500);
}

/** Names compare after case, spacing, dash and punctuation are normalised; a name equal to its code is "no name". */
export function sameName(a: string, b: string) {
  const norm = (x: string) => x.toLowerCase().replace(/[–—]/g, "-").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(a) === norm(b);
}

const DEBIT_NORMAL = /(piutang|receivable|\bkas\b|\bcash\b|\bbank\b|prepaid|dibayar di muka|uang muka|persediaan|inventory)/i;
/** Income/expense and contra accounts are never sign-checked; "Non-Bank" loans aren't banks. */
const NO_SIGN_CHECK = /(revenue|income|expense|pendapatan|beban|biaya|interest|bunga|allowance|penyisihan|akumulasi|accumulat|kontra|contra|non-bank|gain|loss|laba|rugi|in transit)/i;
const CREDIT_NORMAL = /(\butang\b|\bhutang\b|payable|accrued|masih harus dibayar)/i; // "Piutang" contains "utang"

export function planLedger(
  rows: LedgerRow[],
  opts: { entities: Map<string, EntityInfo>; currencyMode: CurrencyMode; rateFor?: RateFor; existingNames?: Map<string, string> },
): Plan {
  const checks: Check[] = [];
  const accounts: Plan["accounts"] = new Map();
  const entityKeyOf = (r: LedgerRow) => r.entity ?? "";

  // BLOCK: unreadable rows.
  for (const r of rows.filter((x) => x.errors.length)) {
    for (const e of r.errors) {
      checks.push({ severity: "BLOCK", code: "ROW_ERROR", message: `${r.ref}: ${e}`, refs: [r.ref], entityKey: entityKeyOf(r) });
    }
  }
  const unknownEntities = [...new Set(rows.map(entityKeyOf))].filter((k) => !opts.entities.has(k));
  for (const k of unknownEntities) {
    const refs = rows.filter((r) => entityKeyOf(r) === k).map((r) => r.ref);
    checks.push({ severity: "BLOCK", code: "UNKNOWN_ENTITY", message: `Entitas "${k || "(kosong)"}" belum dipasangkan ke entitas klien (${refs.length} baris).`, refs: cap(refs), entityKey: k });
  }
  const unknownCurrency = rows.filter((r) => r.currency && !isCurrency(r.currency));
  for (const [cur, list] of groupBy(unknownCurrency, (r) => r.currency!)) {
    checks.push({ severity: "BLOCK", code: "UNKNOWN_CURRENCY", message: `Mata uang ${cur} belum didukung (${list.length} baris).`, refs: cap(list.map((r) => r.ref)) });
  }

  const usable = rows.filter((r) => !r.errors.length && opts.entities.has(entityKeyOf(r)) && (!r.currency || isCurrency(r.currency)));

  // Source accounts + REVIEW: same code, different names.
  for (const r of usable) {
    const k = accountKey(entityKeyOf(r), r.code);
    const a = accounts.get(k);
    const signed = r.debit - r.credit;
    const named = r.name !== r.code;
    if (!a) {
      const prev = opts.existingNames?.get(k);
      accounts.set(k, { entityKey: entityKeyOf(r), code: r.code, name: r.name, previousNames: prev && !sameName(prev, r.name) ? [prev] : [], balance: signed, currency: null });
    } else {
      a.balance += signed;
      if (!named) continue;
      if (a.name === a.code) a.name = r.name;
      else if (!sameName(a.name, r.name)) {
        if (!a.previousNames.some((p) => sameName(p, a.name))) a.previousNames.push(a.name);
        a.name = r.name; // latest name wins (assumption 4)
      }
    }
  }
  for (const a of accounts.values()) {
    a.previousNames = a.previousNames.filter((p) => !sameName(p, a.name));
    if (a.previousNames.length) {
      const refs = usable.filter((r) => entityKeyOf(r) === a.entityKey && r.code === a.code).map((r) => r.ref);
      checks.push({
        severity: "REVIEW",
        code: "CODE_RENAMED",
        message: `Kode ${a.code} dipakai dengan nama berbeda: ${[...a.previousNames, a.name].map((n) => `"${n}"`).join(" → ")}. Pastikan ini akun yang sama, bukan kode yang dipakai ulang.`,
        refs: cap(refs),
        entityKey: a.entityKey,
      });
    }
  }

  // Group into entries.
  const hasVoucher = usable.some((r) => r.voucher);
  const groups = groupBy(usable, (r) => `${entityKeyOf(r)}|${hasVoucher ? (r.voucher ?? "") : ""}|${r.date!.toISOString().slice(0, 10)}`);
  const entries: PlanEntry[] = [];
  const noRate = new Map<string, LedgerRow[]>();
  const missingRate = new Map<string, LedgerRow[]>();

  for (const [key, list] of groups) {
    const ek = entityKeyOf(list[0]);
    const info = opts.entities.get(ek)!;
    const date = list[0].date!;
    const cents: bigint[] = [];
    const lines: PlanLine[] = [];
    let convertedExact = true;
    for (const r of list) {
      const signedCents = r.debit - r.credit;
      const foreign = r.currency && r.currency !== info.currency ? r.currency : null;
      if (foreign && opts.currencyMode === "CONVERT") {
        const rate = r.rate ?? opts.rateFor?.(foreign, info.currency, date) ?? null;
        if (!rate) {
          missingRate.set(`${ek}|${foreign}|${formatDate(date)}`, [...(missingRate.get(`${ek}|${foreign}|${formatDate(date)}`) ?? []), r]);
          convertedExact = false;
          continue;
        }
        const fxMinor = centsToMinor(signedCents < 0n ? -signedCents : signedCents, foreign);
        const functional = convertMinor(fxMinor, foreign, info.currency, rate);
        const signed = signedCents < 0n ? -functional : functional;
        // Back to sen so the entry total and rounding residue are computed over every line alike.
        cents.push(signed * 10n ** BigInt(2 - exponentOf(info.currency)));
        lines.push({ ref: r.ref, code: r.code, name: r.name, amount: signed, fx: { currency: foreign, amount: fxMinor, rate }, memo: r.description || null });
      } else {
        if (foreign) noRate.set(`${ek}|${foreign}`, [...(noRate.get(`${ek}|${foreign}`) ?? []), r]);
        cents.push(signedCents);
        lines.push({ ref: r.ref, code: r.code, name: r.name, amount: 0n, fx: null, memo: [foreign ? `${foreign} dicatat apa adanya` : null, r.description || null].filter(Boolean).join(" · ") || null });
      }
    }
    if (!convertedExact) continue;
    // Rounding (rule 6a): only lines not already converted to functional minor units.
    const { rounded, rounding, total } = roundEntry(cents, info.currency);
    lines.forEach((l, i) => {
      if (!l.fx) l.amount = rounded[i];
    });
    const refs = list.map((r) => r.ref);
    const entry: PlanEntry = {
      key,
      entityKey: ek,
      date,
      ref: rangeRef(refs),
      memo: `Impor ${list[0].voucher ? `bukti ${list[0].voucher}` : `buku besar ${formatDate(date)}`}`,
      lines,
      imbalance: total,
      rounding,
    };
    entries.push(entry);

    if (entry.imbalance !== 0n) {
      checks.push({
        severity: "BLOCK",
        code: "UNBALANCED",
        message: `Jurnal ${info.name} ${formatDate(date)} tidak seimbang: selisih ${formatMoney(entry.imbalance, info.currency)} (debit ${entry.imbalance > 0n ? ">" : "<"} kredit). Terima untuk mencatat selisihnya di 1999 Belum Terklasifikasi.`,
        refs: cap(refs),
        entityKey: ek,
        date,
        amount: entry.imbalance,
        acceptable: true,
        groupKey: key,
      });
    }
    // REVIEW: different currencies balancing on raw numbers.
    const currencies = new Set(list.map((r) => r.currency ?? info.currency));
    if (opts.currencyMode === "FUNCTIONAL" && currencies.size > 1 && entry.imbalance === 0n) {
      checks.push({
        severity: "REVIEW",
        code: "FX_SAME_NUMBER",
        message: `Jurnal ${info.name} ${formatDate(date)} seimbang hanya pada angka mentah padahal barisnya berbeda mata uang (${[...currencies].join(", ")}): kurs belum diterapkan.`,
        refs: cap(refs),
        entityKey: ek,
        date,
        groupKey: key,
      });
    }
  }

  for (const [k, list] of missingRate) {
    const [ek, cur, date] = k.split("|");
    checks.push({ severity: "BLOCK", code: "MISSING_RATE", message: `Kurs ${cur} tanggal ${date} belum ada. Isi di halaman Kurs atau di kolom kurs file.`, refs: cap(list.map((r) => r.ref)), entityKey: ek });
  }
  for (const [k, list] of noRate) {
    const [ek, cur] = k.split("|");
    const info = opts.entities.get(ek)!;
    const gross = list.reduce((s, r) => s + r.debit + r.credit, 0n);
    const largest = list.reduce((m, r) => (r.debit + r.credit > m.debit + m.credit ? r : m), list[0]);
    checks.push({
      severity: "REVIEW",
      code: "FX_NO_RATE",
      message: `${list.length} baris ${cur} di buku ${info.currency} ${info.name} dicatat apa adanya tanpa kurs (total ${formatMoney(centsToMinor(gross, info.currency), info.currency, { bare: true })}; terbesar ${largest.ref} ${largest.code} ${largest.name}).`,
      refs: cap(list.map((r) => r.ref)),
      entityKey: ek,
      amount: centsToMinor(gross, info.currency),
    });
  }

  // REVIEW: a year-end balance against the account's nature (receivable in credit, payable in debit…).
  const years = [...new Set(usable.map((r) => r.date!.getUTCFullYear()))].sort();
  for (const a of accounts.values()) {
    if (NO_SIGN_CHECK.test(a.name)) continue;
    const debitNormal = DEBIT_NORMAL.test(a.name) && !CREDIT_NORMAL.test(a.name);
    const creditNormal = CREDIT_NORMAL.test(a.name) && !DEBIT_NORMAL.test(a.name);
    if (!debitNormal && !creditNormal) continue;
    const info = opts.entities.get(a.entityKey)!;
    const mine = usable.filter((r) => entityKeyOf(r) === a.entityKey && r.code === a.code);
    for (const y of years) {
      const cents = mine.filter((r) => r.date!.getUTCFullYear() <= y).reduce((s, r) => s + r.debit - r.credit, 0n);
      const bal = centsToMinor(cents, info.currency);
      if ((debitNormal && bal < 0n) || (creditNormal && bal > 0n)) {
        checks.push({
          severity: "REVIEW",
          code: "SIGN_AGAINST_TYPE",
          message: `${info.name} ${a.code} ${a.name}: saldo akhir ${y} di file ${debitNormal ? "kredit" : "debit"} ${formatMoney(bal < 0n ? -bal : bal, info.currency)}, berlawanan dengan sifat akunnya.`,
          refs: cap(mine.filter((r) => r.date!.getUTCFullYear() === y).map((r) => r.ref)),
          entityKey: a.entityKey,
          amount: bal,
        });
        break;
      }
    }
  }

  // INFO: stats + rounding.
  for (const [ek, info] of opts.entities) {
    const mine = entries.filter((e) => e.entityKey === ek);
    if (!mine.length) continue;
    const debit = mine.reduce((s, e) => s + e.lines.reduce((t, l) => t + (l.amount > 0n ? l.amount : 0n), 0n), 0n);
    const rounding = mine.reduce((s, e) => s + (e.rounding < 0n ? -e.rounding : e.rounding), 0n);
    const zero = mine.filter((e) => e.imbalance === 0n && e.lines.every((l) => l.amount === 0n)).length;
    checks.push({
      severity: "INFO",
      code: "STATS",
      message: `${info.name}: ${mine.reduce((s, e) => s + e.lines.length, 0)} baris dalam ${mine.length} jurnal, Σdebit ${formatMoney(debit, info.currency)}${rounding ? `, pembulatan ke 7190 total ${formatMoney(rounding, info.currency)} di ${mine.filter((e) => e.rounding).length} jurnal` : ""}${zero ? `, ${zero} jurnal bernilai nol dilewati` : ""}.`,
      refs: [],
      entityKey: ek,
    });
  }
  return { entries, checks, accounts };
}

export function planNeraca(
  rows: NeracaRow[],
  totals: NeracaTotal[],
  opts: { entityKey: string; entity: EntityInfo; date: Date; sheet: string; existingNames?: Map<string, string> },
): Plan {
  const checks: Check[] = [];
  const accounts: Plan["accounts"] = new Map();
  const { entity, entityKey, date } = opts;
  for (const r of rows) for (const e of r.errors) checks.push({ severity: "BLOCK", code: "ROW_ERROR", message: `${r.ref}: ${e}`, refs: [r.ref], entityKey });
  const usable = rows.filter((r) => !r.errors.length);
  for (const r of usable) {
    const k = accountKey(entityKey, r.code);
    const prev = opts.existingNames?.get(k);
    accounts.set(k, { entityKey, code: r.code, name: r.name, previousNames: prev && prev !== r.name ? [prev] : [], balance: r.amount, currency: null });
  }
  const { rounded, rounding, total } = roundEntry(usable.map((r) => r.amount), entity.currency);
  const entry: PlanEntry = {
    key: `${entityKey}|NERACA|${date.toISOString().slice(0, 10)}`,
    entityKey,
    date,
    ref: rangeRef(usable.map((r) => r.ref)),
    memo: `Saldo awal dari Neraca ${formatDate(date)}`,
    lines: usable.map((r, i) => ({ ref: r.ref, code: r.code, name: r.name, amount: rounded[i], fx: null, memo: null })),
    imbalance: total,
    rounding,
  };
  if (total !== 0n) {
    checks.push({
      severity: "BLOCK",
      code: "UNBALANCED",
      message: `Neraca ${entity.name} ${formatDate(date)} tidak seimbang: aset − (liabilitas + ekuitas) = ${formatMoney(total, entity.currency)}. Terima untuk mencatat selisihnya di 1999 Belum Terklasifikasi.`,
      refs: [],
      entityKey,
      date,
      amount: total,
      acceptable: true,
      groupKey: entry.key,
    });
  }
  // REVIEW: the file's own totals vs the imported rows.
  const assetCents = usable.filter((r) => r.typeHint === "ASET").reduce((s, r) => s + r.amount, 0n);
  const leCents = -usable.filter((r) => r.typeHint === "LIABILITAS" || r.typeHint === "EKUITAS").reduce((s, r) => s + r.amount, 0n);
  for (const t of totals) {
    const mine = t.kind === "ASSETS" ? assetCents : t.kind === "LIAB_EQUITY" ? leCents : null;
    if (mine === null) continue;
    const diff = centsToMinor(mine - t.amount, entity.currency);
    if (diff !== 0n) {
      checks.push({ severity: "REVIEW", code: "TOTAL_MISMATCH", message: `"${t.label}" di file ${formatMoney(centsToMinor(t.amount, entity.currency), entity.currency)} ≠ jumlah baris ${formatMoney(centsToMinor(mine, entity.currency), entity.currency)}.`, refs: [t.ref], entityKey });
    } else {
      checks.push({ severity: "INFO", code: "TOTAL_OK", message: `"${t.label}" cocok dengan jumlah baris: ${formatMoney(centsToMinor(mine, entity.currency), entity.currency)}.`, refs: [t.ref], entityKey });
    }
  }
  checks.push({
    severity: "INFO",
    code: "STATS",
    message: `${entity.name}: ${usable.length} akun per ${formatDate(date)}${rounding ? `, pembulatan ke 7190 ${formatMoney(rounding < 0n ? -rounding : rounding, entity.currency)}` : ""}.`,
    refs: [],
    entityKey,
  });
  return { entries: [entry], checks, accounts };
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of list) {
    const k = key(t);
    const arr = m.get(k);
    if (arr) arr.push(t);
    else m.set(k, [t]);
  }
  return m;
}

export const hasBlocking = (checks: Check[]) => checks.some((c) => c.severity === "BLOCK" && !c.acceptable);

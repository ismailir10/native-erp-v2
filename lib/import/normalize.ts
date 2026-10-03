import { createHash } from "node:crypto";
import { ParseError, type ParsedRow, type ParsedStatement } from "@/lib/import/types";
import { dateOnly, formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/**
 * Merchant key: the stable part of a bank description, used for rules, memory and the
 * AI cache. "TRSF E-BANKING DB 0108/FTSCY/WS95051 15000000.00 PT PAKAN JAYA" → "PT PAKAN JAYA".
 * Deterministic and cheap; the AI cache is keyed on this, so better keys = fewer paid calls.
 */
const NOISE = [
  /\bTRSF\b|\bTRF\b|\bTRANSFER\b|\bE-BANKING\b|\bEBANKING\b|\bM-BANKING\b|\bMB\b|\bIB\b/g,
  /\bDB\b|\bCR\b|\bKR\b|\bDR\b/g,
  /\bBI[- ]?FAST\b|\bRTGS\b|\bSKN\b|\bLLG\b|\bSWITCHING\b|\bKE\b|\bDARI\b|\bFROM\b|\bTO\b|\bKLIRING\b/g,
  /\b\d{2,4}\/[A-Z0-9]+\/[A-Z0-9]+\b/g, // 0108/FTSCY/WS95051
  /\b[A-Z]{0,4}\d[A-Z0-9]{5,}\b/g, // reference numbers
  /\b\d+([.,]\d+)*\b/g, // amounts, dates, account numbers
  /[^A-Z &]/g,
];

export function merchantKey(description: string): string {
  let s = ` ${description.toUpperCase()} `;
  for (const re of NOISE) s = s.replace(re, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s || description.toUpperCase().slice(0, 40).trim();
}

/**
 * Words that say how money moved, not who it came from or went to. A key made only of these (plus references and digits)
 * names no counterparty — "BI FAST OUTGOING", "PINJAMAN LOAN", "TRSF E-BANKING DB 0108/…" — so the same key covers
 * unrelated payments: it must never be learned (Memory), turned into a rule or grouped as *serupa*.
 * Fee, interest, tax and stamp words are not here: those descriptions mean the same thing every time.
 */
const CHANNEL_WORDS = new Set(
  (
    "BI FAST BIF OUTGOING INCOMING TRSF TRF TRANSFER TRANSFERS EBANKING MBANKING IBANKING BANKING INTERNET MOBILE ONLINE DB CR KR DR DEBIT KREDIT CREDIT " +
    "RTGS SKN LLG KLIRING CLEARING SWITCHING ONLINE KE DARI FROM TO VIA ATAS NAMA AN OVERBOOKING PINDAH DANA BUKU PB " +
    "PINJAMAN LOAN LOANS SETORAN SETOR TUNAI TARIK TARIKAN PENARIKAN CASH WITHDRAWAL ATM DEP DEPOSIT VA VIRTUAL ACCOUNT " +
    "TOPUP TOP UP REVERSAL KOREKSI REVERSE PAYMENT PEMBAYARAN BAYAR"
  ).split(" "),
);

export function isGenericKey(key: string): boolean {
  const words = key.toUpperCase().split(/\s+/).filter((w) => /^[A-Z]{2,}$/.test(w));
  return words.every((w) => CHANNEL_WORDS.has(w));
}

export function rowHash(row: ParsedRow): string {
  return createHash("sha1")
    .update([row.date.toISOString().slice(0, 10), row.amount.toString(), row.description, row.balance?.toString() ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/**
 * Hashes of a statement's rows, in file order. Two real bank lines can be identical (two Rp 15.000 fees on one day) and only a file
 * that prints a running balance tells them apart. The unique (bankAccountId, hash) index would reject the second one, so each repeat
 * within the file carries its ordinal. The first of a kind keeps its plain hash: lines imported before this stay matched, and the
 * same file imported again produces the same hashes, so the dedupe still pairs the twins one to one.
 */
export function rowHashes(rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = rowHash(row);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : createHash("sha1").update(`${base}|#${n}`).digest("hex").slice(0, 24);
  });
}

export type ContinuityResult = { ok: boolean; note: string | null; brokenRows: number[] };

/**
 * Running-balance continuity: opening + Σ amounts must walk through every printed balance
 * and land on the closing balance. A break means missing/duplicated rows in the file.
 */
export function checkContinuity(st: ParsedStatement): ContinuityResult {
  let running = st.openingBalance;
  const broken: number[] = [];
  const labels: string[] = [];
  for (const r of st.rows) {
    running += r.amount;
    if (r.balance !== null && r.balance !== running) {
      broken.push(r.rowNumber);
      labels.push(r.sheet ? `${r.sheet}!${r.rowNumber}` : String(r.rowNumber));
      running = r.balance;
    }
  }
  const endOk = running === st.closingBalance;
  if (broken.length === 0 && endOk) return { ok: true, note: null, brokenRows: [] };
  const parts: string[] = [];
  // Only the first row breaks: the opening header and the first printed balance disagree. Undecidable — a typo in the header, or a row
  // before the first one missing from the file — so both readings are said.
  const first = st.rows[0];
  if (broken.length === 1 && endOk && first && broken[0] === first.rowNumber && first.balance !== null) {
    const implied = first.balance - first.amount;
    return { ok: false, note: `Saldo awal di file ${formatMoney(st.openingBalance, "IDR")} tidak nyambung dengan baris pertama (saldo ${formatMoney(first.balance, "IDR")} − mutasi ${formatMoney(first.amount, "IDR")} = ${formatMoney(implied, "IDR")}): saldo awal salah tulis, atau ada transaksi sebelum baris pertama yang tidak ada di file`, brokenRows: broken };
  }
  if (broken.length) parts.push(`Saldo berjalan tidak nyambung di baris ${labels.slice(0, 5).join(", ")}${labels.length > 5 ? "…" : ""}`);
  if (!endOk) parts.push("Saldo akhir tidak sama dengan saldo awal + mutasi");
  return { ok: false, note: parts.join(". "), brokenRows: broken };
}

const rowLabel = (r: ParsedRow) => (r.sheet ? `${r.sheet}!${r.rowNumber}` : String(r.rowNumber));
const idr = (n: bigint) => formatMoney(n < 0n ? -n : n, "IDR");
const monthIndex = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
const ym = (t: number) => ({ y: new Date(t).getUTCFullYear(), m: new Date(t).getUTCMonth() + 1 });

/**
 * A year typo (02/08/2023 in a 2026 statement, use-case UC-B1f): rows more than six months from the main run of months, in another year,
 * at most 5 and under a fifth of the rows. Each gets the one date with the same day and month inside the main run, or null.
 */
function yearTypos(rows: ParsedRow[]): { row: ParsedRow; fix: Date | null; start: Date; end: Date }[] {
  const months = [...new Set(rows.map((r) => monthIndex(r.date)))].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const m of months) {
    const last = runs[runs.length - 1];
    if (last && m - last[last.length - 1] <= 6) last.push(m);
    else runs.push([m]);
  }
  if (runs.length < 2) return [];
  const size = (run: number[]) => rows.filter((r) => run.includes(monthIndex(r.date))).length;
  const main = runs.reduce((a, b) => (size(b) > size(a) ? b : a));
  const years = new Set(main.map((m) => Math.floor(m / 12)));
  const inMain = rows.filter((r) => main.includes(monthIndex(r.date)));
  const far = rows.filter((r) => !main.includes(monthIndex(r.date)) && !years.has(r.date.getUTCFullYear()));
  if (!far.length || far.length > 5 || far.length * 5 >= rows.length) return [];
  const start = new Date(Math.min(...inMain.map((r) => +r.date)));
  const end = new Date(Math.max(...inMain.map((r) => +r.date)));
  return far.map((row) => {
    const fixes: Date[] = [];
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
      const c = dateOnly(y, row.date.getUTCMonth() + 1, row.date.getUTCDate());
      // Inside the run's months (a typo on the period's first day is before the other rows).
      if (c.getUTCDate() === row.date.getUTCDate() && +c >= +dateOnly(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) && +c <= +dateOnly(end.getUTCFullYear(), end.getUTCMonth() + 2, 0)) fixes.push(c);
    }
    return { row, fix: fixes.length === 1 ? fixes[0] : null, start, end };
  });
}

/**
 * The running balance is the statement's source of truth (accounting-rules 12, use-case UC-B1). Pure; run right after parsing, before the
 * zero-row filter and the hashes, so the same file always repairs the same way.
 * - A year typo with one fix inside the statement's run of months is read with that year; a far date with no fix refuses the file.
 * - A row where previous balance − amount equals its printed balance had its direction written the wrong way: flipped.
 * - A balance-only row (a date, no amount) whose balance moved takes the move as its amount; one whose balance didn't move is dropped.
 * - When every printed balance chains and only the closing header disagrees, the running balance is the closing.
 * Direction and amount repairs are kept only when every printed balance then chains; otherwise the rows stay as written (the import shows
 * the break). Every repair is noted with the value the file wrote; the row keeps it in `written` and its `rawRow`.
 */
export function repairStatement(input: ParsedStatement): ParsedStatement {
  const notes: string[] = [];
  let st = input;

  // 1. Year typos (dates only: the balance chain doesn't depend on them).
  const typos = yearTypos(st.rows.filter((r) => !r.balanceOnly));
  if (typos.length) {
    const bad = typos.find((t) => !t.fix);
    if (bad) {
      throw new ParseError(`Tanggal ${formatDate(bad.row.date)} di baris ${rowLabel(bad.row)} jauh dari periode file (${formatDate(bad.start)} – ${formatDate(bad.end)}). Periksa tahunnya di file, lalu unggah ulang.`);
    }
    const fixed = new Map(typos.map((t) => [t.row, t.fix!]));
    const rows = st.rows.map((r) => (fixed.has(r) ? { ...r, date: fixed.get(r)!, written: { ...r.written, date: r.date } } : r));
    for (const t of typos) notes.push(`Baris ${rowLabel(t.row)}: tanggal ${formatDate(t.row.date)} dibaca ${formatDate(t.fix!)} (tahun salah ketik; tanggal tertulis tetap di baris sumber).`);
    // A period the reader took from a mistyped row moves with it.
    const dated = rows.filter((r) => !r.balanceOnly).map((r) => +r.date);
    const off = (d: Date) => !typos.some((t) => t.start.getUTCFullYear() <= d.getUTCFullYear() && d.getUTCFullYear() <= t.end.getUTCFullYear());
    st = {
      ...st,
      rows,
      // Whole months, as a reader dates a period it takes from its rows.
      periodStart: off(st.periodStart) ? (({ y, m }) => dateOnly(y, m, 1))(ym(Math.min(...dated))) : st.periodStart,
      periodEnd: off(st.periodEnd) ? (({ y, m }) => dateOnly(y, m + 1, 0))(ym(Math.max(...dated))) : st.periodEnd,
    };
  }

  // 2. Direction and amount from the balance, kept only if the whole chain then holds.
  let running = st.openingBalance;
  const repaired: ParsedRow[] = [];
  const chainNotes: string[] = [];
  for (const r of st.rows) {
    if (r.balanceOnly) {
      if (r.balance !== null && r.balance !== running) {
        const amount = r.balance - running;
        repaired.push({ ...r, amount, balanceOnly: undefined, written: { ...r.written, amount: 0n } });
        chainNotes.push(`Baris ${rowLabel(r)}: nominal kosong tetapi saldo ${amount > 0n ? "naik" : "turun"} ${idr(amount)}; dicatat ${amount > 0n ? "masuk" : "keluar"} ${idr(amount)} dari selisih saldo.`);
        running = r.balance;
      }
      continue;
    }
    const next = running + r.amount;
    if (r.balance !== null && r.balance !== next && r.amount !== 0n && running - r.amount === r.balance) {
      repaired.push({ ...r, amount: -r.amount, written: { ...r.written, amount: r.amount } });
      chainNotes.push(`Baris ${rowLabel(r)}: arah dibalik — file menulis ${r.amount > 0n ? "masuk" : "keluar"} ${idr(r.amount)}, tetapi saldo ${r.amount > 0n ? "turun" : "naik"} sebesar itu. Dicatat mengikuti saldo; nilai tertulis tetap di baris sumber.`);
      running = r.balance;
      continue;
    }
    repaired.push(r);
    running = r.balance ?? next;
  }
  const withoutBalanceOnly = st.rows.filter((r) => !r.balanceOnly);
  if (chainNotes.length) {
    const trial = { ...st, rows: repaired };
    const check = checkContinuity(trial);
    const last = repaired[repaired.length - 1];
    const holds = check.brokenRows.length === 0 && (check.ok || (last?.balance ?? null) !== null);
    if (holds) {
      st = trial;
      notes.push(...chainNotes);
    } else st = { ...st, rows: withoutBalanceOnly };
  } else st = { ...st, rows: withoutBalanceOnly };

  // 3. The closing header against a chain that holds everywhere: the chain wins, the header is reported.
  const after = checkContinuity(st);
  const last = st.rows[st.rows.length - 1];
  if (!after.ok && after.brokenRows.length === 0 && last && last.balance !== null && last.balance !== st.closingBalance) {
    notes.push(`Saldo akhir di file ${formatMoney(st.closingBalance, "IDR")} ≠ saldo berjalan ${formatMoney(last.balance, "IDR")}; saldo berjalan dipakai. Periksa saldo akhir di file.`);
    st = { ...st, closingBalance: last.balance };
  }
  return notes.length ? { ...st, notes: [...(st.notes ?? []), ...notes] } : st;
}

import type { Db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import type { TbRow } from "@/lib/reports/ledger";
import type { Control } from "@/lib/controls";

/**
 * Sanity controls (accounting-rules 22a, ADR 0009): the books add up, but do they make sense?
 * Deterministic only. Each check is emitted only when it flags; `runControls` adds one PASS row for a clean entity.
 */

/** Words that mark financing or own-money movements — balance-sheet, not Laba Rugi. */
export const FINANCING = /\b(PINJAMAN|LOAN|PRK|PLAFON|ANGSURAN|POKOK|SETORAN MODAL|MODAL|DEPOSITO|PENEMPATAN|PINDAH ?BUKU|OVERBOOK\w*|ANTAR REKENING)\b/i;
/** Interest, fees and taxes on those movements are legitimately P&L. */
export const FINANCING_COST = /\b(BUNGA|INTEREST|BIAYA|FEE|ADM\w*|PAJAK|TAX|MATERAI|STAMP)\b/i;
/** Below this, an AI answer is a guess; HEURISTIC always is. */
export const GUESS_CONFIDENCE = 0.6;

type Args = {
  clientId: string;
  entity: { id: string; shortName: string; functionalCurrency: string };
  tb: TbRow[];
  start: Date;
  end: Date;
  base: string;
  acks: Map<string, string>;
  /** A bank control already says this month's statement is missing: don't flag the empty month twice. */
  statementMissing: boolean;
};

export async function sanityControls(db: Db, a: Args): Promise<Control[]> {
  const fmt = (v: bigint) => formatMoney(v, a.entity.functionalCurrency);
  const e = a.entity;
  const out: Control[] = [];
  const control = (key: string, title: string, status: Control["status"], detail: string, href?: string) =>
    out.push({ key: `${key}:${e.id}`, title, scope: e.shortName, status, detail, href, ack: status === "REVIEW" ? a.acks.get(`${key}:${e.id}`) : undefined });

  // 1. Total assets can't be negative.
  const assets = a.tb.filter((r) => r.account.type === "ASET").reduce((s, r) => s + r.net, 0n);
  if (assets < 0n) control("nature-total", "Total aset negatif", "FAIL", `Total aset ${fmt(assets)} — tidak mungkin; cek klasifikasi transaksi`, `${a.base}/reports?entity=${e.id}`);

  // 2. Balance-sheet accounts against their nature (contra accounts already carry the opposite normal balance).
  const against = a.tb.filter(
    (r) =>
      (r.account.type === "ASET" || r.account.type === "LIABILITAS") &&
      !r.account.isIntercompany && !r.account.isClearing && !r.account.isSuspense &&
      (r.account.normalBalance === "DEBIT" ? r.net < 0n : r.net > 0n),
  );
  if (against.length) {
    const list = against.slice(0, 5).map((r) => `${r.account.code} ${r.account.name} saldo ${r.net < 0n ? "kredit" : "debit"} ${fmt(r.net < 0n ? -r.net : r.net)}`);
    control("nature", "Saldo berlawanan dengan sifat akun", "REVIEW", list.join("; ") + (against.length > 5 ? `; +${against.length - 5} lainnya` : ""), `${a.base}/ledger/${against[0].account.code}?entity=${e.id}`);
  }

  // 3. Financing text classified to the P&L (bank lines; ledger lines keep no description per line).
  const { txs, financing, guesses } = await flaggedBankRows(db, a.clientId, e.id, a.start, a.end);
  if (financing.length) {
    const total = financing.reduce((s, t) => s + (t.amount < 0n ? -t.amount : t.amount), 0n);
    const top = [...financing].sort((x, y) => (abs(y.amount) > abs(x.amount) ? 1 : -1)).slice(0, 3);
    control(
      "pl-financing",
      "Pinjaman / modal / pindah dana tercatat di Laba Rugi",
      "REVIEW",
      `${financing.length} transaksi, total ${fmt(total)}: ${top.map((t) => `“${t.description.slice(0, 40)}” ${fmt(t.amount)} → ${t.accountCode}`).join("; ")}`,
      `${a.base}/ledger/${top[0].accountCode}?period=${periodKey(a.start)}&entity=${e.id}`,
    );
  }

  // 4. A month without data after the entity started and outside any posted ledger file's date range.
  if (!a.statementMissing && txs.length === 0) {
    const inPeriod = await db.journalLine.count({ where: { entityId: e.id, date: { gte: a.start, lte: a.end } } });
    const before = inPeriod === 0 && (await db.journalLine.findFirst({ where: { entityId: e.id, date: { lt: a.start } }, select: { id: true } }));
    // A posted ledger file whose rows span this month already says "nothing happened here" (e.g. an annual GL).
    const covered = before && (await db.ledgerImport.findFirst({ where: { clientId: a.clientId, status: "POSTED", mode: "LEDGER", periodStart: { lte: a.end }, periodEnd: { gte: a.start }, entries: { some: { entityId: e.id } } }, select: { id: true } }));
    if (before && !covered) control("activity", "Tidak ada transaksi bulan ini", "REVIEW", "Belum ada mutasi atau buku besar untuk bulan ini. Pastikan datanya sudah lengkap sebelum ditutup", `${a.base}/import`);
  }

  // 5. Guesses accepted as they were.
  if (guesses.length) {
    const total = guesses.reduce((s, t) => s + abs(t.amount), 0n);
    control("guess", "Tebakan diterima tanpa diubah", "REVIEW", `${guesses.length} transaksi (${fmt(total)}) disetujui persis seperti tebakan dengan keyakinan rendah`, `${a.base}/ledger?entity=${e.id}`);
  }

  return out;
}

/** Bank rows behind the financing and guess checks; shared with the AI close review so both see the same rows. */
export async function flaggedBankRows(db: Db, clientId: string, entityId: string, start: Date, end: Date) {
  const txs = await db.bankTransaction.findMany({
    where: { entityId, date: { gte: start, lte: end }, status: { in: ["POSTED", "REVIEWED"] }, accountCode: { not: null } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const plCodes = new Set((await db.account.findMany({ where: { clientId, type: { in: ["PENDAPATAN", "BEBAN"] } }, select: { code: true } })).map((x) => x.code));
  return {
    txs,
    financing: txs.filter((t) => plCodes.has(t.accountCode!) && FINANCING.test(t.description) && !FINANCING_COST.test(t.description)),
    guesses: txs.filter((t) => t.status === "REVIEWED" && (t.method === "HEURISTIC" || (t.method === "AI" && t.confidence < GUESS_CONFIDENCE))),
  };
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const periodKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

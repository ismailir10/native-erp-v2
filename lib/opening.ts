import type { Db } from "@/lib/db";
import { postJournal, type PostLine } from "@/lib/ledger/post";
import { formatDate } from "@/lib/format";
import { parseRupiah } from "@/lib/money";
import { ACCOUNT_CODES } from "@/lib/coa/template";

/**
 * Saldo awal (accounting-rules §5): one OPENING entry per entity, posted through postJournal().
 * The difference between the listed balances goes to 3200 Saldo Laba, the same plug the demo seed uses.
 * Bank lines are prefilled from the earliest imported statement's opening balance, so bank recon holds.
 */
export class OpeningError extends Error {}

export type OpeningLineInput = { accountCode: string; debit: string; credit: string };

export async function openingContext(db: Db, clientId: string) {
  const entities = await db.entity.findMany({
    where: { clientId },
    include: { bankAccounts: { include: { account: true, imports: { orderBy: { periodStart: "asc" }, take: 1 } } } },
  });
  const openings = await db.journalEntry.findMany({
    where: { entityId: { in: entities.map((e) => e.id) }, kind: "OPENING" },
    include: { lines: { include: { account: true } } },
    orderBy: { date: "asc" },
  });
  const firstTx = await db.bankTransaction.groupBy({ by: ["entityId"], where: { entityId: { in: entities.map((e) => e.id) } }, _min: { date: true } });

  return entities
    .sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN")) // companies first
    .map((e) => {
      const firstImport = e.bankAccounts.flatMap((b) => b.imports).sort((x, y) => +x.periodStart - +y.periodStart)[0];
      const firstDate = firstTx.find((t) => t.entityId === e.id)?._min.date ?? null;
      const suggested = firstImport ? new Date(+firstImport.periodStart - 86_400_000) : lastDayOfPreviousMonth();
      const existing = openings.find((o) => o.entityId === e.id);
      return {
        entity: { id: e.id, name: e.name, shortName: e.shortName },
        existing: existing && {
          date: existing.date,
          lines: existing.lines.map((l) => ({ code: l.account.code, name: l.account.name, debit: l.debit, credit: l.credit })),
        },
        firstTransactionDate: firstDate,
        suggestedDate: suggested,
        banks: e.bankAccounts
          .sort((a, b) => a.account.code.localeCompare(b.account.code))
          .map((b) => ({
            accountCode: b.account.code,
            label: `${b.label} · ${b.number}`,
            statementOpening: b.imports[0]?.openingBalance ?? null,
            source: b.imports[0] ? `Saldo awal di ${b.imports[0].fileName} (${formatDate(b.imports[0].periodStart)})` : null,
          })),
      };
    });
}

function lastDayOfPreviousMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
}

export async function postOpening(db: Db, input: { clientId: string; entityId: string; date: Date; lines: OpeningLineInput[] }) {
  const entity = await db.entity.findFirst({ where: { id: input.entityId, clientId: input.clientId } });
  if (!entity) throw new OpeningError("Entitas tidak ditemukan.");
  const existing = await db.journalEntry.findFirst({ where: { entityId: entity.id, kind: "OPENING" } });
  if (existing) throw new OpeningError(`Saldo awal ${entity.shortName} sudah dicatat per ${formatDate(existing.date)}. Koreksi lewat Jurnal Penyesuaian.`);
  const first = await db.bankTransaction.findFirst({ where: { entityId: entity.id }, orderBy: { date: "asc" } });
  if (first && +input.date >= +first.date) {
    throw new OpeningError(`Tanggal saldo awal harus sebelum transaksi bank pertama (${formatDate(first.date)}).`);
  }

  const accounts = new Map((await db.account.findMany({ where: { clientId: input.clientId } })).map((a) => [a.code, a]));
  const lines: PostLine[] = [];
  let debit = 0n;
  let credit = 0n;
  for (const l of input.lines) {
    let dr: bigint;
    let cr: bigint;
    try {
      dr = parseRupiah(l.debit);
      cr = parseRupiah(l.credit);
    } catch {
      throw new OpeningError("Ada nominal yang tidak bisa dibaca. Tulis angka saja, misalnya 12.500.000.");
    }
    if (dr === 0n && cr === 0n) continue;
    const acc = accounts.get(l.accountCode);
    if (!acc) throw new OpeningError("Pilih akun untuk setiap baris yang berisi nominal.");
    lines.push({ accountId: acc.id, debit: dr, credit: cr });
    debit += dr;
    credit += cr;
  }
  if (lines.length === 0) throw new OpeningError("Isi minimal satu saldo.");
  const retained = accounts.get(ACCOUNT_CODES.RETAINED)!;
  if (debit !== credit) lines.push(debit > credit ? { accountId: retained.id, credit: debit - credit, memo: "Penyeimbang saldo awal" } : { accountId: retained.id, debit: credit - debit, memo: "Penyeimbang saldo awal" });

  return db.$transaction((tx) =>
    postJournal(tx, { entityId: entity.id, date: input.date, kind: "OPENING", memo: `Saldo awal per ${formatDate(input.date)}`, lines }),
  );
}

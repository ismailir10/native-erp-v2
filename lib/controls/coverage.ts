import type { StatementImport } from "@/lib/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";

import { readValidation } from "@/lib/import/validation";

/** Coverage is the union of declared intervals, never the span of observed transactions. */
export async function statementCoverage(db: Db | Tx, bankAccountId: string, opening: Date | null, start: Date, end: Date) {
  const coverage = await db.statementImport.findMany({
    where: { bankAccountId, periodStart: { lte: end }, periodEnd: { gte: start } },
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (coverage.length) {
    let next = Math.max(+start, opening ? +opening + 86_400_000 : +start);
    for (const source of coverage) {
      if (readValidation(source.sourceValidation)?.source.period !== "DECLARED") continue;
      if (+source.periodStart > next) break;
      next = Math.max(next, +source.periodEnd + 86_400_000);
    }
    return { state: next > +end ? "covered" as const : "partial" as const, coverage };
  }
  const first = opening ? null : await db.statementImport.findFirst({ where: { bankAccountId }, orderBy: { periodStart: "asc" }, select: { periodStart: true } });
  const startsAfter = opening ? +end <= +opening : !!first && +end < +first.periodStart;
  if (startsAfter) return { state: "before" as const, from: opening ? new Date(+opening + 86_400_000) : first!.periodStart };
  return { state: "missing" as const };
}

/** The date of the entity's first Saldo Awal entry, if any. */
export async function openingDate(db: Db | Tx, entityId: string) {
  return (await db.journalEntry.findFirst({ where: { entityId, kind: "OPENING" }, orderBy: { date: "asc" }, select: { date: true } }))?.date ?? null;
}

/** Shared evidence assessment for close controls and report readiness. */
export function statementEvidence(coverage: StatementImport[], end: Date, booksOpening: Date | null) {
  const validations = coverage.map((c) => ({ c, v: readValidation(c.sourceValidation) }));
  const messages = validations.flatMap(({ c, v }) => v ? v.issues.map((i) => `${c.fileName}: ${i.message}`) : [`${c.fileName}: bukti validasi sumber belum tersedia; impor ulang file asli.`]);
  const beforeBooks = booksOpening ? validations.filter(({ c, v }) => v?.source.period === "DECLARED" && v.source.opening === "PRINTED" && +c.periodStart <= +booksOpening) : [];
  for (const { c } of beforeBooks) messages.push(`${c.fileName}: saldo pembuka sumber mendahului awal pembukuan; cocokkan dengan bukti saldo sebelum pembukuan dimulai.`);
  let conflict = validations.some(({ c, v }) => !c.continuityOk || v?.issues.some((i) => i.severity === "CONFLICT"));
  // Adjacent independently printed fragments must hand the same balance to one
  // another. Offsetting gaps cannot turn a final matching GL into completeness.
  const byEnd = new Map<number, StatementImport[]>();
  const byStart = new Map<number, StatementImport>();
  for (const { c, v } of validations) {
    if (v?.source.period !== "DECLARED") continue;
    if (v.source.opening === "PRINTED") {
      const previous = byStart.get(+c.periodStart);
      if (previous && previous.openingBalance !== c.openingBalance) {
        conflict = true;
        messages.push(`${previous.fileName} → ${c.fileName}: saldo pembuka untuk awal periode yang sama berbeda.`);
      }
      if (!previous) byStart.set(+c.periodStart, c);
    }
    if (v.source.opening === "PRINTED") for (const previous of byEnd.get(+c.periodStart - 86_400_000) ?? []) {
      if (previous.closingBalance !== c.openingBalance) {
        conflict = true;
        messages.push(`${previous.fileName} → ${c.fileName}: saldo penutup dan saldo pembuka tidak sama.`);
      }
    }
    if (v.source.closing !== "DERIVED" && !v.issues.some((i) => i.code === "CLOSING_BEFORE_END")) {
      const group = byEnd.get(+c.periodEnd) ?? [];
      group.push(c); byEnd.set(+c.periodEnd, group);
    }
  }
  const checkpoints = validations.filter(({ c, v }) => +c.periodEnd === +end && v?.source.period === "DECLARED" && v.source.closing !== "DERIVED" && !v.issues.some((i) => i.code === "CLOSING_BEFORE_END"));
  const checkpoint = checkpoints.at(-1)?.c;
  const disagree = !!checkpoint && checkpoints.some(({ c }) => c.closingBalance !== checkpoint.closingBalance);
  if (disagree) messages.push("Saldo akhir antarfile berbeda. Periksa sumber sebelum menutup bulan.");
  return { checkpoint, conflict: conflict || disagree, uncertain: beforeBooks.length > 0 || validations.some(({ v }) => !v || v.issues.length > 0), messages };
}

/** Reconcile every comparable source checkpoint, including those inside overlapping files. */
export async function sourceCheckpointConflicts(db: Db | Tx, entityId: string, accountId: string, coverage: StatementImport[], end: Date, booksOpening: Date | null) {
  const checkpoints = coverage.flatMap((c) => {
    const v = readValidation(c.sourceValidation);
    if (v?.source.period !== "DECLARED") return [];
    const points: { date: Date; balance: bigint; message: string }[] = [];
    // Opening is the balance before the first covered day. Never compare it to
    // a zero ledger before the entity's books actually start.
    if (v.source.opening === "PRINTED" && (!booksOpening || +c.periodStart > +booksOpening)) points.push({
      date: new Date(+c.periodStart - 86_400_000), balance: c.openingBalance,
      message: `${c.fileName}: saldo pembuka ${c.periodStart.toISOString().slice(0, 10)} tidak sama dengan buku besar sebelum periode itu.`,
    });
    if (+c.periodEnd <= +end && v.source.closing !== "DERIVED" && !v.issues.some((i) => i.code === "CLOSING_BEFORE_END")) points.push({
      date: c.periodEnd, balance: c.closingBalance,
      message: `${c.fileName}: saldo penutup ${c.periodEnd.toISOString().slice(0, 10)} tidak sama dengan buku besar pada tanggal itu.`,
    });
    return points;
  }).sort((a, b) => +a.date - +b.date);
  if (!checkpoints.length) return [];
  const movements = await db.journalLine.groupBy({ by: ["date"], where: { entityId, accountId, date: { lte: end } }, _sum: { debit: true, credit: true }, orderBy: { date: "asc" } });
  let index = 0;
  let balance = 0n;
  const conflicts: string[] = [];
  for (const point of checkpoints) {
    while (index < movements.length && +movements[index].date <= +point.date) {
      balance += (movements[index]._sum.debit ?? 0n) - (movements[index]._sum.credit ?? 0n);
      index++;
    }
    if (point.balance !== balance) conflicts.push(point.message);
  }
  return conflicts;
}

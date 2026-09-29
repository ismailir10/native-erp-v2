import type { Db } from "@/lib/db";
import type { LeaseTiming } from "@/lib/generated/prisma/enums";
import { formatDate, formatPeriod } from "@/lib/format";
import { leaseSchedule, positionAt } from "@/lib/leases/schedule";
import { leasesVsLedger, terms } from "@/lib/leases/register";

/** Serialisable views for the Sewa (PSAK 116) page (bigint as string across the server → client boundary, rule 6). */

export const INTERVAL_LABEL: Record<number, string> = { 1: "bulanan", 3: "triwulanan", 6: "semesteran", 12: "tahunan" };
export const TIMING_LABEL: Record<LeaseTiming, string> = { ADVANCE: "di muka", ARREARS: "di akhir" };

export type LeaseRowView = {
  id: string;
  name: string;
  lessor: string;
  start: string;
  end: string;
  months: number;
  payment: string;
  interval: string;
  timing: string;
  rate: string;
  status: "AKTIF" | "SELESAI" | "BELUM_MULAI" | "DIBATALKAN";
  cancelled: string | null;
  canCancel: boolean;
  due: number;
  rou: string;
  accumulated: string;
  carrying: string;
  liability: string;
  current: string;
  nonCurrent: string;
  schedule: { k: number; period: string; payment: string; interest: string; closing: string; depreciation: string; carrying: string; posted: boolean }[];
};

export type LeaseRegisterView = {
  entity: { id: string; name: string; shortName: string; currency: string };
  rows: LeaseRowView[];
  totals: { rou: string; accumulated: string; carrying: string; liability: string; current: string; nonCurrent: string };
  ledger: { rou: string; accumulated: string; liability: string; equal: boolean } | null;
  due: number;
};

export async function leaseRegisterViews(db: Db, clientId: string, year: number, month: number, entities: { id: string; name: string; shortName: string; functionalCurrency: string; kind: string }[]): Promise<LeaseRegisterView[]> {
  const out: LeaseRegisterView[] = [];
  const ordered = [...entities].sort((a, b) => Number(a.kind === "PERORANGAN") - Number(b.kind === "PERORANGAN"));
  for (const e of ordered) {
    const leases = await db.lease.findMany({ where: { clientId, entityId: e.id }, include: { postings: { select: { month: true } }, cancelEntry: { select: { date: true } } }, orderBy: [{ startYear: "asc" }, { startMonth: "asc" }, { name: "asc" }] });
    if (!leases.length) continue;
    const t0 = { rou: 0n, accumulated: 0n, liability: 0n, current: 0n, nonCurrent: 0n };
    let due = 0;
    const rows = leases.map((l): LeaseRowView => {
      const t = terms(l);
      const s = leaseSchedule(t);
      const p = positionAt(t, s, year, month);
      const posted = new Set(l.postings.map((x) => x.month));
      const cancelled = !!l.cancelEntryId;
      const rowDue = cancelled ? 0 : Array.from({ length: p.k }, (_, i) => i + 1).filter((k) => !posted.has(k)).length;
      if (!cancelled) {
        t0.rou += p.rou;
        t0.accumulated += p.accumulated;
        t0.liability += p.liability;
        t0.current += p.current;
        t0.nonCurrent += p.nonCurrent;
        due += rowDue;
      }
      const last = s.months[s.months.length - 1];
      const zero = cancelled ? 0n : null;
      return {
        id: l.id,
        name: l.name,
        lessor: l.lessor,
        start: formatPeriod(l.startYear, l.startMonth),
        end: formatPeriod(last.year, last.month),
        months: l.months,
        payment: l.payment.toString(),
        interval: INTERVAL_LABEL[l.intervalMonths],
        timing: TIMING_LABEL[l.timing],
        rate: `${(l.rateBp / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`,
        status: cancelled ? "DIBATALKAN" : !p.started ? "BELUM_MULAI" : p.k === l.months ? "SELESAI" : "AKTIF",
        cancelled: l.cancelEntry ? formatDate(l.cancelEntry.date) : null,
        canCancel: !cancelled && posted.size === 0,
        due: rowDue,
        rou: (zero ?? p.rou).toString(),
        accumulated: (zero ?? p.accumulated).toString(),
        carrying: (zero ?? p.rou - p.accumulated).toString(),
        liability: (zero ?? p.liability).toString(),
        current: (zero ?? p.current).toString(),
        nonCurrent: (zero ?? p.nonCurrent).toString(),
        schedule: s.months.map((m) => ({ k: m.k, period: formatPeriod(m.year, m.month), payment: m.payment.toString(), interest: m.interest.toString(), closing: m.closing.toString(), depreciation: m.depreciation.toString(), carrying: (s.rou - m.accumulated).toString(), posted: posted.has(m.k) })),
      };
    });
    const ledger = await leasesVsLedger(db, clientId, e.id, year, month);
    out.push({
      entity: { id: e.id, name: e.name, shortName: e.shortName, currency: e.functionalCurrency },
      rows,
      totals: { rou: t0.rou.toString(), accumulated: t0.accumulated.toString(), carrying: (t0.rou - t0.accumulated).toString(), liability: t0.liability.toString(), current: t0.current.toString(), nonCurrent: t0.nonCurrent.toString() },
      ledger: ledger ? { rou: ledger.ledger.rou.toString(), accumulated: ledger.ledger.accumulated.toString(), liability: ledger.ledger.liability.toString(), equal: ledger.equal } : null,
      due,
    });
  }
  return out;
}

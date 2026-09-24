import type { Db } from "@/lib/db";
import { bankAccountCode } from "@/lib/coa/template";
import { classificationNets } from "@/lib/ledger/bank";
import { trialBalance, combinedWorksheet } from "@/lib/reports/ledger";
import { formatRupiah } from "@/lib/money";
import { DEMO_MONTHS, scenarios, type ClientScenario } from "@/lib/demo/scenario";
import { DEPRECIATION } from "@/lib/demo/seed";

/**
 * Layer-2 verification ("verify:books"): recompute every entity's trial balance at every
 * month-end from the generator's ground truth — independently of the pipeline — and compare
 * with what the app derives from its GL. Any difference is a bug somewhere in
 * parse → classify → post → report.
 */
export type VerifyResult = { checks: number; failures: string[] };

function expectedNets(sc: ClientScenario, entityIdx: number, monthEnd: Date, opts: { includeLive: boolean }) {
  const nets = new Map<string, bigint>();
  const add = (code: string, v: bigint) => nets.set(code, (nets.get(code) ?? 0n) + v);

  // bank GL codes follow creation order across entities (lib/setup.ts)
  const bankCode = new Map<string, string>();
  let idx = 0;
  sc.spec.entities.forEach((e, ei) =>
    e.banks.forEach((_, bi) => {
      const key = Object.entries(sc.banks).find(([, b]) => b.entity === ei && b.bank === bi)![0];
      bankCode.set(key, bankAccountCode(idx++));
    }),
  );

  // openings (+ plug to 3200)
  let plug = 0n;
  for (const [key, b] of Object.entries(sc.banks)) if (b.entity === entityIdx) { add(bankCode.get(key)!, b.opening); plug += b.opening; }
  for (const o of sc.openings[entityIdx] ?? []) { add(o.code, o.amount); plug += o.amount; }
  add("3200", -plug);

  const lu = sc.liveUpload;
  const closed = (y: number, m: number) => y < sc.closedThrough.year || (y === sc.closedThrough.year && m <= sc.closedThrough.month);
  for (const l of sc.lines) {
    if (sc.banks[l.bankKey].entity !== entityIdx || l.date > monthEnd) continue;
    const isLive = lu && l.bankKey === lu.bankKey && l.date.getUTCFullYear() === lu.year && l.date.getUTCMonth() + 1 === lu.month;
    if (isLive && !opts.includeLive) continue;
    add(bankCode.get(l.bankKey)!, l.amount);
    const stillOpen = l.open && !closed(l.date.getUTCFullYear(), l.date.getUTCMonth() + 1);
    for (const [code, v] of classificationNets(l.amount, stillOpen ? { accountCode: "1999" } : l.truth)) add(code, v);
  }
  if (sc.key === DEPRECIATION.clientKey && entityIdx === DEPRECIATION.entity) {
    for (const { year, month } of DEMO_MONTHS) {
      if (!closed(year, month) || new Date(Date.UTC(year, month, 0)) > monthEnd) continue;
      add("6180", DEPRECIATION.monthly);
      add("1219", -DEPRECIATION.monthly);
    }
  }
  return nets;
}

export async function verifyBooks(db: Db, opts: { includeLive?: boolean } = {}): Promise<VerifyResult> {
  const failures: string[] = [];
  let checks = 0;
  for (const sc of scenarios()) {
    const client = await db.client.findFirst({ where: { name: sc.spec.name }, include: { entities: true } });
    if (!client) { failures.push(`${sc.spec.name}: klien tidak ada — jalankan demo:reset`); continue; }
    for (const { year, month } of DEMO_MONTHS) {
      const monthEnd = new Date(Date.UTC(year, month, 0));
      for (let ei = 0; ei < sc.spec.entities.length; ei++) {
        const entity = client.entities.find((e) => e.name === sc.spec.entities[ei].name)!;
        const expected = expectedNets(sc, ei, monthEnd, { includeLive: Boolean(opts.includeLive) });
        const tb = await trialBalance(db, { clientId: client.id, entityIds: [entity.id] }, monthEnd);
        const actual = new Map(tb.map((r) => [r.account.code, r.net]));
        for (const code of new Set([...expected.keys(), ...actual.keys()])) {
          checks++;
          const e = expected.get(code) ?? 0n;
          const a = actual.get(code) ?? 0n;
          if (e !== a) failures.push(`${sc.spec.entities[ei].name} ${year}-${String(month).padStart(2, "0")} akun ${code}: harapan ${formatRupiah(e)} ≠ aplikasi ${formatRupiah(a)}`);
        }
      }
    }
    if (sc.spec.entities.length > 1) {
      const ws = await combinedWorksheet(db, client.id, new Date(Date.UTC(2026, 7, 31)));
      checks++;
      const combinedSum = ws.rows.reduce((s, r) => s + r.combined, 0n);
      if (combinedSum !== 0n) failures.push(`${sc.spec.name}: kertas kerja gabungan tidak seimbang (${formatRupiah(combinedSum)})`);
    }
  }
  return { checks, failures };
}

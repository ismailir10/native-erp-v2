import { splitPpn } from "@/lib/money";
import { merchantKey } from "@/lib/import/normalize";
import type { ClientScenario } from "@/lib/demo/scenario";

/**
 * The demo's Coretax faktur (synthetic, I5c): one per taxed bank line of the scenario — keluaran for receipts tagged PPN keluaran,
 * masukan (credited) for purchases tagged PPN masukan — with the PPN the books split from it (rule 8), so every month ties once its
 * lines are reviewed. The August lines left open for the walk (the DP and the machine) have their faktur too: the ekualisasi shows them
 * as not yet in the books until Review decides them. Numbers are deterministic; names are the bank text's counterparty.
 */
export type DemoFaktur = { entity: number; direction: "KELUARAN" | "MASUKAN"; number: string; date: Date; year: number; month: number; name: string; dpp: bigint; ppn: bigint; sourceRef: string };

export function demoFaktur(sc: ClientScenario): DemoFaktur[] {
  const out: DemoFaktur[] = [];
  const seq = { KELUARAN: 0, MASUKAN: 0 };
  const taxed = sc.lines
    .filter((l) => (l.amount > 0n && l.truth.taxTag === "PPN_KELUARAN") || (l.amount < 0n && l.truth.taxTag === "PPN_MASUKAN"))
    .sort((a, b) => +a.date - +b.date || a.description.localeCompare(b.description));
  for (const l of taxed) {
    const direction = l.amount > 0n ? "KELUARAN" : "MASUKAN";
    const { dpp, ppn } = splitPpn(l.amount > 0n ? l.amount : -l.amount);
    const n = ++seq[direction];
    out.push({
      entity: sc.banks[l.bankKey].entity,
      direction,
      number: `${direction === "KELUARAN" ? "040026" : "070026"}${String(n).padStart(11, "0")}`,
      date: l.date,
      year: l.date.getUTCFullYear(),
      month: l.date.getUTCMonth() + 1,
      name: merchantKey(l.description),
      dpp,
      ppn,
      sourceRef: `${direction === "KELUARAN" ? "Keluaran" : "Masukan"}!${n + 1}`,
    });
  }
  return out;
}

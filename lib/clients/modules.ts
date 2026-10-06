import type { Db } from "@/lib/db";
import { TRADING } from "@/lib/controls/sanity";

/**
 * The adjustment and subledger modules a client sees in its menu (ADR 0014 §2, I1b). A module shows when the client turned it on or
 * when it already holds data — a module in use never disappears; a trading client has Persediaan on by default. Presentation only:
 * every page stays reachable by URL, and figures count in reports and controls whether or not the module is shown.
 */
export const MODULES = [
  { key: "receivables", href: "/receivables", label: "Piutang & Utang", description: "Faktur penjualan dan pembelian, pelunasan dari mutasi bank, umur piutang dan CKPN." },
  { key: "inventory", href: "/inventory", label: "Persediaan", description: "Stock opname akhir bulan dan HPP metode periodik." },
  { key: "assets", href: "/assets", label: "Aset Tetap", description: "Register aset, penyusutan komersial dan fiskal, pelepasan aset." },
  { key: "leases", href: "/leases", label: "Sewa (PSAK 116)", description: "Aset hak guna dan liabilitas sewa dengan jadwalnya." },
  { key: "benefits", href: "/benefits", label: "Imbalan Kerja", description: "Liabilitas imbalan kerja PSAK 24 dari data karyawan." },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const isModuleKey = (k: string): k is ModuleKey => MODULES.some((m) => m.key === k);

export type ClientModules = { enabled: ModuleKey[]; inUse: ModuleKey[]; visible: ModuleKey[] };

/** Modules per client of a firm: one grouped query per module table, never one per client. */
export async function clientModules(db: Db, firmId: string): Promise<Map<string, ClientModules>> {
  const [clients, invoices, counts, assets, leases, employees] = await Promise.all([
    db.client.findMany({ where: { firmId }, select: { id: true, industry: true, modules: true } }),
    db.invoice.groupBy({ by: ["clientId"], where: { client: { firmId } } }),
    db.inventoryCount.groupBy({ by: ["clientId"], where: { client: { firmId } } }),
    db.fixedAsset.groupBy({ by: ["clientId"], where: { client: { firmId } } }),
    db.lease.groupBy({ by: ["clientId"], where: { client: { firmId } } }),
    db.employee.groupBy({ by: ["clientId"], where: { firmId } }),
  ]);
  const has: Record<ModuleKey, Set<string>> = {
    receivables: new Set(invoices.map((r) => r.clientId)),
    inventory: new Set(counts.map((r) => r.clientId)),
    assets: new Set(assets.map((r) => r.clientId)),
    leases: new Set(leases.map((r) => r.clientId)),
    benefits: new Set(employees.map((r) => r.clientId)),
  };
  return new Map(
    clients.map((c) => {
      const enabled = c.modules.filter(isModuleKey);
      const inUse = MODULES.map((m) => m.key).filter((k) => has[k].has(c.id));
      const trading = c.industry && TRADING.test(c.industry) ? (["inventory"] as ModuleKey[]) : [];
      const on = new Set<ModuleKey>([...enabled, ...inUse, ...trading]);
      return [c.id, { enabled, inUse, visible: MODULES.map((m) => m.key).filter((k) => on.has(k)) }];
    }),
  );
}

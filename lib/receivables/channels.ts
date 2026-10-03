import type { Db } from "@/lib/db";
import { LedgerError } from "@/lib/ledger/post";
import { financialYear } from "@/lib/fiscal";
import { periodBounds } from "@/lib/format";

/**
 * Penjualan per channel (UC-B5): a customer can carry a sales channel (free text, the suggestions below), and the receivables page shows
 * sales — the DPP of non-voided sales invoices, Saldo Awal items excluded (they are last year's sales) — for the month and the financial
 * year to date, by channel and then by customer. Customers without one are *Tanpa channel*. Derived only: nothing is posted.
 */
export const CHANNEL_SUGGESTIONS = ["Marketplace", "Reseller", "Langsung"] as const;
export const CHANNEL_MAX = 40;
export const NO_CHANNEL = "Tanpa channel";

export async function setContactChannel(db: Db, input: { clientId: string; contactId: string; channel: string | null }) {
  const channel = (input.channel ?? "").trim().replace(/\s+/g, " ") || null;
  if (channel && channel.length > CHANNEL_MAX) throw new LedgerError(`Nama channel paling panjang ${CHANNEL_MAX} karakter.`);
  const contact = await db.contact.findFirst({ where: { id: input.contactId, clientId: input.clientId } });
  if (!contact) throw new LedgerError("Pelanggan tidak ditemukan.");
  // One spelling per channel: "marketplace" joins an existing "Marketplace".
  const known = channel ? await db.contact.findFirst({ where: { clientId: input.clientId, channel: { equals: channel, mode: "insensitive" } }, select: { channel: true } }) : null;
  const suggested = channel ? CHANNEL_SUGGESTIONS.find((s) => s.toLowerCase() === channel.toLowerCase()) : undefined;
  return db.contact.update({ where: { id: contact.id }, data: { channel: known?.channel ?? suggested ?? channel } });
}

export type ChannelSales = {
  currency: string;
  channels: { channel: string; month: bigint; ytd: bigint; customers: { id: string; name: string; month: bigint; ytd: bigint }[] }[];
  total: { month: bigint; ytd: bigint };
};

/** Sales by channel and customer for `month` of `year` and the financial year to date, per currency of the entities given. */
export async function salesByChannel(db: Db, clientId: string, entities: { id: string; functionalCurrency: string }[], fiscalEndMonth: number, year: number, month: number): Promise<ChannelSales[]> {
  const { start, end } = periodBounds(year, month);
  const from = financialYear(fiscalEndMonth, year, month).start;
  const rows = await db.invoice.findMany({
    where: { clientId, direction: "SALES", voidedAt: null, opening: false, entityId: { in: entities.map((e) => e.id) }, issueDate: { gte: from, lte: end } },
    select: { entityId: true, dpp: true, issueDate: true, contact: { select: { id: true, name: true, channel: true } } },
  });
  const out: ChannelSales[] = [];
  for (const currency of [...new Set(entities.map((e) => e.functionalCurrency))]) {
    const ids = new Set(entities.filter((e) => e.functionalCurrency === currency).map((e) => e.id));
    const mine = rows.filter((r) => ids.has(r.entityId));
    if (!mine.length) continue;
    const channels = new Map<string, Map<string, { id: string; name: string; month: bigint; ytd: bigint }>>();
    for (const r of mine) {
      const key = r.contact.channel ?? NO_CHANNEL;
      const customers = channels.get(key) ?? channels.set(key, new Map()).get(key)!;
      const c = customers.get(r.contact.id) ?? customers.set(r.contact.id, { id: r.contact.id, name: r.contact.name, month: 0n, ytd: 0n }).get(r.contact.id)!;
      c.ytd += r.dpp;
      if (+r.issueDate >= +start) c.month += r.dpp;
    }
    const desc = <T extends { ytd: bigint; name?: string; channel?: string }>(a: T, b: T) => (b.ytd > a.ytd ? 1 : b.ytd < a.ytd ? -1 : 0);
    const list = [...channels].map(([channel, customers]) => {
      const cs = [...customers.values()].sort(desc);
      return { channel, month: cs.reduce((t, c) => t + c.month, 0n), ytd: cs.reduce((t, c) => t + c.ytd, 0n), customers: cs };
    });
    // Largest first; customers without a channel last, whatever their size, so the gap reads as a to-do.
    list.sort((a, b) => Number(a.channel === NO_CHANNEL) - Number(b.channel === NO_CHANNEL) || desc(a, b));
    out.push({ currency, channels: list, total: { month: list.reduce((t, c) => t + c.month, 0n), ytd: list.reduce((t, c) => t + c.ytd, 0n) } });
  }
  return out;
}

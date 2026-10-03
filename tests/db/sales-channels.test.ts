import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { createInvoice, voidInvoice } from "@/lib/receivables/invoices";
import { salesByChannel, setContactChannel } from "@/lib/receivables/channels";
import { postOpening } from "@/lib/opening";
import { dateOnly } from "@/lib/format";

type G = Awaited<ReturnType<typeof makeGroup>>;

const sale = (g: G, number: string, contactName: string, issueDate: string, dpp: string, more: Record<string, unknown> = {}) =>
  createInvoice(db, { clientId: g.client.id, entityId: g.pt.entity.id, direction: "SALES", contactName, number, issueDate, dpp, ppn: "0", counterCode: "4100", ...more });

describe("penjualan per channel (UC-B5)", () => {
  beforeEach(resetDb);

  it("totals DPP by channel then customer for the month and the year to date, without voided or Saldo Awal documents", async () => {
    const g = await makeGroup();
    await postOpening(db, { clientId: g.client.id, entityId: g.pt.entity.id, date: dateOnly(2026, 6, 30), lines: [{ accountCode: "1130", debit: "9000000", credit: "0" }] });
    await sale(g, "SA-1", "Toko Reseller A", "2026-06-15", "9000000", { opening: true });
    const a = await sale(g, "N-1", "Toko Reseller A", "2026-07-10", "4000000");
    await sale(g, "N-2", "Toko Reseller A", "2026-08-10", "6000000");
    const b = await sale(g, "N-3", "Toko Reseller B", "2026-08-12", "2000000");
    const m = await sale(g, "N-4", "Shopee", "2026-08-20", "500000");
    await sale(g, "N-5", "Pembeli Langsung", "2026-08-21", "300000");
    const wrong = await sale(g, "N-6", "Shopee", "2026-08-22", "999000");
    await voidInvoice(db, { clientId: g.client.id, invoiceId: wrong.id, reason: "Dokumen pemasok, bukan nota penjualan" });

    await setContactChannel(db, { clientId: g.client.id, contactId: a.contactId, channel: " Reseller " });
    await setContactChannel(db, { clientId: g.client.id, contactId: b.contactId, channel: "reseller" }); // joins the existing spelling
    await setContactChannel(db, { clientId: g.client.id, contactId: m.contactId, channel: "marketplace" }); // the suggestion's spelling
    await expect(setContactChannel(db, { clientId: g.client.id, contactId: m.contactId, channel: "x".repeat(41) })).rejects.toThrow("paling panjang 40 karakter");

    const [s] = await salesByChannel(db, g.client.id, [g.pt.entity], 12, 2026, 8);
    expect(s.channels.map((c) => [c.channel, c.month, c.ytd, c.customers.map((x) => [x.name, x.month, x.ytd])])).toEqual([
      ["Reseller", 8_000_000n, 12_000_000n, [["Toko Reseller A", 6_000_000n, 10_000_000n], ["Toko Reseller B", 2_000_000n, 2_000_000n]]],
      ["Marketplace", 500_000n, 500_000n, [["Shopee", 500_000n, 500_000n]]],
      ["Tanpa channel", 300_000n, 300_000n, [["Pembeli Langsung", 300_000n, 300_000n]]],
    ]);
    expect(s.total).toEqual({ month: 8_800_000n, ytd: 12_800_000n });
    // Clearing a channel moves the customer back.
    await setContactChannel(db, { clientId: g.client.id, contactId: m.contactId, channel: "" });
    expect((await salesByChannel(db, g.client.id, [g.pt.entity], 12, 2026, 8))[0].channels.map((c) => c.channel)).toEqual(["Reseller", "Tanpa channel"]);
    // A year closing in July starts in August: July's sale falls in the previous year.
    expect((await salesByChannel(db, g.client.id, [g.pt.entity], 7, 2026, 8))[0].total).toEqual({ month: 8_800_000n, ytd: 8_800_000n });
  });
});

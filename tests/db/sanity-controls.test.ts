import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { makePdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { reviewTransaction } from "@/lib/review";
import { lockPeriod, runControls, CloseError } from "@/lib/controls";
import { postJournal } from "@/lib/ledger/post";
import { createClient } from "@/lib/setup";
import { dateOnly } from "@/lib/format";
import ExcelJS from "exceljs";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";

const statement = makePdf([
  [
    ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 2222222222"]], [[40, "Periode : 01/08/2026 - 31/08/2026"]]]),
    ...table(740, [
      [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
      [[40, "01/08/2026"], [130, "SALDO AWAL"], [500, "0,00"]],
      [[40, "04/08/2026"], [130, "PENCAIRAN PINJAMAN KMK"], [430, "100.000.000,00"], [510, "100.000.000,00"]],
      [[40, "10/08/2026"], [130, "BUNGA PINJAMAN KMK"], [360, "1.000.000,00"], [520, "99.000.000,00"]],
      [[40, "20/08/2026"], [130, "ANGSURAN POKOK KMK"], [360, "1.000.000,00"], [520, "98.000.000,00"]],
    ]),
  ],
]);

const accountId = async (clientId: string, code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId, code } } })).id;
const post = async (entityId: string, clientId: string, date: Date, dr: string, cr: string, amount: bigint) =>
  db.$transaction(async (tx) =>
    postJournal(tx, { entityId, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await accountId(clientId, dr), debit: amount }, { accountId: await accountId(clientId, cr), credit: amount }] }),
  );

describe("sanity controls", () => {
  beforeEach(resetDb);

  it("flags loan proceeds booked as revenue and guesses accepted as-is; a real reclass clears the financing flag", async () => {
    const g = await makeGroup();
    await importStatement(db, { bankAccountId: g.pt.banks[1].id, fileName: "mandiri.pdf", data: statement, provider: null });
    const txs = await db.bankTransaction.findMany({ where: { entityId: g.pt.entity.id }, orderBy: { date: "asc" } });
    // Interest charged by the bank is a firm rule (7110, posted); drawdown and principal get balance-sheet suggestions to review.
    expect(txs.map((t) => [t.method, t.suggestedCode ?? t.accountCode])).toEqual([["HEURISTIC", "2210"], ["RULE", "7110"], ["HEURISTIC", "2210"]]);
    // The accountant books the drawdown to revenue anyway (the mistake the control exists for) and accepts the principal guess as-is.
    await reviewTransaction(db, { bankTxId: txs[0].id, accountCode: "4100", taxTag: null });
    await reviewTransaction(db, { bankTxId: txs[2].id, accountCode: txs[2].suggestedCode!, taxTag: null });

    const find = async (key: string) => (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === `${key}:${g.pt.entity.id}`);
    const financing = await find("pl-financing");
    expect(financing?.status).toBe("REVIEW");
    expect(financing?.detail).toMatch(/^1 transaksi, total Rp 100\.000\.000: “PENCAIRAN PINJAMAN KMK” Rp 100\.000\.000 → 4100/);
    expect(financing?.detail).not.toMatch(/BUNGA/); // interest on a loan is P&L
    expect((await find("guess"))?.detail).toBe("1 transaksi (Rp 1.000.000) disetujui persis seperti tebakan dengan keyakinan rendah");
    expect(await find("sanity")).toBeUndefined();

    await reviewTransaction(db, { bankTxId: txs[0].id, accountCode: "2210", taxTag: null }); // accountant: it's a bank loan
    expect(await find("pl-financing")).toBeUndefined();
    expect(await find("guess")).toBeDefined(); // an accepted guess still needs its note
  });

  it("fails on negative total assets, lists balances against their nature, skips contra accounts, and blocks the lock", async () => {
    const g = await makeGroup();
    const pt = g.pt.entity.id;
    await post(pt, g.client.id, dateOnly(2026, 8, 1), "1210", "3100", 10_000_000n);
    await post(pt, g.client.id, dateOnly(2026, 8, 31), "6180", "1219", 2_000_000n); // accumulated depreciation: credit is its nature
    await post(pt, g.client.id, dateOnly(2026, 8, 31), "6190", "1130", 30_000_000n); // receivable with a credit balance

    const controls = await runControls(db, g.client.id, 2026, 8);
    const total = controls.find((c) => c.key === `nature-total:${pt}`)!;
    expect(total.status).toBe("FAIL");
    expect(total.detail).toMatch(/^Total aset -Rp 22\.000\.000/);
    const nature = controls.find((c) => c.key === `nature:${pt}`)!;
    expect(nature.status).toBe("REVIEW");
    expect(nature.detail).toBe("1130 Piutang Usaha saldo kredit Rp 30.000.000");
    await expect(lockPeriod(db, g.client.id, 2026, 8, "uji")).rejects.toThrow(CloseError);
  });

  it("flags an empty month only after the entity started, and gives a clean entity one PASS row", async () => {
    const g = await makeGroup();
    const { client, entities } = await db.$transaction((tx) =>
      createClient(tx, g.firm.id, { name: "Klien Buku Besar", industry: "jasa", entities: [{ name: "PT Tanpa Bank", shortName: "TB", kind: "PT", banks: [] }] }),
    );
    const e = entities[0].entity.id;
    await post(e, client.id, dateOnly(2026, 7, 15), "1120", "4100", 5_000_000n);

    const key = (cs: Awaited<ReturnType<typeof runControls>>) => cs.filter((c) => c.scope === "TB" && /^(activity|sanity)/.test(c.key)).map((c) => `${c.key.split(":")[0]}=${c.status}`);
    expect(key(await runControls(db, client.id, 2026, 6))).toEqual(["sanity=PASS"]); // before the first line: no empty-month flag
    expect(key(await runControls(db, client.id, 2026, 7))).toEqual(["sanity=PASS"]);
    expect(key(await runControls(db, client.id, 2026, 8))).toEqual(["activity=REVIEW"]);

    // An entity whose bank statement is missing already has that REVIEW; no second "empty month" flag.
    await post(g.pt.entity.id, g.client.id, dateOnly(2026, 7, 15), "1120", "4100", 1_000_000n);
    const pt = (await runControls(db, g.client.id, 2026, 8)).filter((c) => c.scope === g.pt.entity.shortName);
    expect(pt.some((c) => c.key.startsWith("activity:"))).toBe(false);
  });

  it("doesn't call a month empty when a posted ledger file spans it, but does after the file ends", async () => {
    const g = await makeGroup();
    const { client } = await db.$transaction((tx) =>
      createClient(tx, g.firm.id, { name: "Klien GL Tahunan", industry: "jasa", entities: [{ name: "PT Tahunan", shortName: "TH", kind: "PT", banks: [] }] }),
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("GL");
    ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Debit", "Credit"]);
    for (const [m, amt] of [[0, 100], [2, 50]] as const) {
      ws.addRow(["TH", new Date(Date.UTC(2026, m, 31)), "10000", "Kas", amt, 0]);
      ws.addRow(["TH", new Date(Date.UTC(2026, m, 31)), "40000", "Pendapatan", 0, amt]);
    }
    const st = await stageImport(db, { firmId: g.firm.id, clientId: client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    if (st.status !== "STAGED") throw new Error("not staged");
    await suggestMappings(db, { firmId: g.firm.id, clientId: client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, st.importId);
    await acceptMappings(db, client.id, src.map((x) => ({ sourceAccountId: x.id, accountCode: x.suggestedCode ?? (x.code === "10000" ? "1120" : "4100"), method: "MANUAL" as const })));
    await postImport(db, client.id, st.importId);

    const activity = async (m: number) => (await runControls(db, client.id, 2026, m)).some((c) => c.key.startsWith("activity:"));
    expect(await activity(2)).toBe(false); // inside the file's Jan–Mar range, no rows: nothing happened
    expect(await activity(4)).toBe(true); // after the file ends: data missing
  });

  it("flags a company whose liabilities exceed its assets, never a person", async () => {
    const g = await makeGroup();
    const pt = g.pt.entity.id;
    await post(pt, g.client.id, dateOnly(2026, 8, 1), "1120", "2210", 10_000_000n);
    await post(pt, g.client.id, dateOnly(2026, 8, 20), "6190", "1120", 4_000_000n);
    await post(pt, g.client.id, dateOnly(2026, 8, 21), "6190", "2120", 8_000_000n);
    await post(g.owner.entity.id, g.client.id, dateOnly(2026, 8, 21), "3300", "2120", 1_000_000n);
    const controls = await runControls(db, g.client.id, 2026, 8);
    const gc = controls.find((c) => c.key === `going-concern:${pt}`)!;
    expect(gc.status).toBe("REVIEW");
    expect(gc.detail).toBe("Ekuitas -Rp 12.000.000: liabilitas Rp 18.000.000 melebihi aset Rp 6.000.000. Nilai kelangsungan usaha dan ungkapkan rencana manajemen di CALK");
    expect(controls.find((c) => c.key === `going-concern:${g.owner.entity.id}`)).toBeUndefined();
  });

  it("flags sales without cost of sales for a trading business only", async () => {
    const g = await makeGroup();
    const pt = g.pt.entity.id;
    await post(pt, g.client.id, dateOnly(2026, 8, 5), "1120", "4100", 50_000_000n);
    const key = `no-cogs:${pt}`;
    expect((await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === key)).toBeUndefined(); // agritech: not trading

    await db.client.update({ where: { id: g.client.id }, data: { industry: "perdagangan pakaian (gamis)" } });
    const flag = (await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === key)!;
    expect(flag.status).toBe("REVIEW");
    expect(flag.detail).toMatch(/^Penjualan Rp 50\.000\.000 bulan ini tanpa pembelian atau HPP/);

    await post(pt, g.client.id, dateOnly(2026, 8, 6), "5100", "1120", 30_000_000n);
    expect((await runControls(db, g.client.id, 2026, 8)).find((c) => c.key === key)).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../helpers";
import { makePdf, smbcGiroDepositPdf, table } from "../pdf-fixture";
import { importStatement } from "@/lib/import/pipeline";
import { openingContext, postOpening } from "@/lib/opening";
import { createClient, createFirm } from "@/lib/setup";
import { dateOnly } from "@/lib/format";

/** An owner with an SMBC giro (deposit interest lands there) and a Jenius account that repays a loan. */
async function owner() {
  return db.$transaction(async (tx) => {
    const firm = await createFirm(tx, "KJA Uji");
    const { client, entities } = await createClient(tx, firm.id, {
      name: "Grup Deposito",
      industry: "perdagangan",
      entities: [
        {
          name: "Budi Hartono",
          shortName: "Budi",
          kind: "PERORANGAN",
          banks: [
            { bank: "SMBC", number: "05243002331", label: "SMBC Giro" },
            { bank: "SMBC", number: "90022152088", label: "Jenius" },
          ],
        },
      ],
    });
    return { client, owner: entities[0] };
  });
}

const jenius = makePdf([
  [
    ...table(800, [[[40, "PT Bank Mandiri (Persero) Tbk"]], [[40, "Nomor Rekening : 90022152088"]], [[40, "Periode : 01/05/2026 - 31/05/2026"]]]),
    ...table(740, [
      [[40, "Tanggal"], [130, "Keterangan"], [360, "Debit"], [440, "Kredit"], [520, "Saldo"]],
      [[40, "01/05/2026"], [130, "SALDO AWAL"], [500, "500.000.000,00"]],
      [[40, "18/05/2026"], [130, "Pinjaman - Loan"], [360, "300.000.000,00"], [510, "200.000.000,00"]],
    ]),
  ],
]);

describe("Saldo Awal from the statements", () => {
  beforeEach(resetDb);

  it("offers each deposit a statement lists once, with its source, and flags loan rows", async () => {
    const g = await owner();
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "smbc-mei.pdf", data: smbcGiroDepositPdf(), provider: null });
    await importStatement(db, { bankAccountId: g.owner.banks[1].id, fileName: "jenius-mei.pdf", data: jenius, provider: null });

    const [ctx] = await openingContext(db, g.client.id);
    expect(ctx.deposits).toEqual([
      { number: "0524DEP004097", amount: 3_600_000_000n, note: "Deposito Berjangka 0524DEP004097 di smbc-mei.pdf (jatuh tempo 26 Agu 2026, bunga 5%)" },
    ]);
    expect(ctx.loanRows).toBe(1);

    // The same file imported again (e.g. into another account) doesn't list the deposit twice.
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "smbc-mei.pdf", data: smbcGiroDepositPdf(), provider: null });
    expect((await openingContext(db, g.client.id))[0].deposits).toHaveLength(1);

    // Posting the deposit with the bank balances leaves only the real difference on 3200.
    const entry = await postOpening(db, {
      clientId: g.client.id,
      entityId: g.owner.entity.id,
      date: dateOnly(2026, 4, 30),
      lines: [
        { accountCode: "1101", debit: "649.569", credit: "" },
        { accountCode: "1260", debit: "3.600.000.000", credit: "" },
        { accountCode: "2210", debit: "", credit: "3.600.000.000" },
      ],
    });
    const plug = (await db.journalLine.findMany({ where: { entryId: entry.id }, include: { account: true } })).find((l) => l.account.code === "3200");
    expect(plug?.credit).toBe(649_569n);
  });

  it("offers only deposits listed on the earliest statement period, not ones placed later", async () => {
    const g = await owner();
    await importStatement(db, { bankAccountId: g.owner.banks[0].id, fileName: "smbc-mei.pdf", data: smbcGiroDepositPdf(), provider: null });
    // A June statement listing a second deposit, opened in June: a movement, not an opening balance.
    await db.statementImport.create({
      data: {
        firmId: g.client.firmId, bankAccountId: g.owner.banks[0].id, fileName: "smbc-juni.pdf", format: "SMBC",
        periodStart: dateOnly(2026, 6, 1), periodEnd: dateOnly(2026, 6, 30), openingBalance: 12_485_186n, closingBalance: 12_485_186n, rowCount: 0, continuityOk: true,
        deposits: [{ number: "0624DEP009999", product: "Deposito Berjangka", currency: "IDR", rate: "4,5%", maturity: "2026-09-30", idrBalance: "500000000" }],
      },
    });
    expect((await openingContext(db, g.client.id))[0].deposits.map((d) => d.number)).toEqual(["0524DEP004097"]);
  });
});

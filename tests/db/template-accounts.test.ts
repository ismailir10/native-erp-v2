import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { templateAccounts } from "@/lib/coa/ensure";
import { createClientAccount, deterministicSuggestion } from "@/lib/ledger-import/mapping";

describe("template accounts added after a client was set up", () => {
  beforeEach(resetDb);

  it("creates them on first use, keeps them free from imported accounts, refuses a look-alike", async () => {
    const g = await makeGroup();
    // A client from before the template had 1135 / 1230: an imported receivable may not take 1135.
    await db.account.deleteMany({ where: { clientId: g.client.id, code: { in: ["1135", "1230"] } } });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push(await db.$transaction((tx) => createClientAccount(tx, g.client.id, "PIUTANG_USAHA", `Piutang ${i}`)));
    expect(codes).toEqual(["1131", "1132", "1133", "1134", "1136", "1137"]);
    // An imported allowance is proposed to 1135 even before the client has it (never netted into 1130).
    const chart = await db.account.findMany({ where: { clientId: g.client.id } });
    expect(deterministicSuggestion({ code: "1-1300", name: "Cadangan Kerugian Piutang", typeHint: "ASET" }, { accounts: chart, priorByName: new Map() })?.accountCode).toBe("1135");
    // Missing and free → created from the template.
    const ids = await db.$transaction((tx) => templateAccounts(tx, g.client.id, ["1135"]));
    expect(await db.account.findUniqueOrThrow({ where: { id: ids.get("1135")! } })).toMatchObject({ name: "Cadangan Kerugian Penurunan Nilai Piutang", normalBalance: "CREDIT" });
    // Same code and line but another account (e.g. created by hand) → refused by name, nothing posted into it.
    await db.account.create({ data: { firmId: g.firm.id, clientId: g.client.id, code: "1230", name: "Kendaraan Operasional", type: "ASET", fsLine: "ASET_TETAP", normalBalance: "DEBIT" } });
    await expect(db.$transaction((tx) => templateAccounts(tx, g.client.id, ["1230"]))).rejects.toThrow(/Akun 1230 dipakai untuk "Kendaraan Operasional", bukan Aset Hak Guna/);
  });
});

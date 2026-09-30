import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";

const CSV = [
  "Tanggal;Keterangan;Debet;Kredit;Saldo",
  "10/01/2027;SETORAN PAJAK PPH 21 DJP DES;7000000;0;93000000",
  "12/01/2027;SETORAN PPH 23 JASA;2000000;0;91000000",
  "15/01/2027;BEA METERAI;10000;0;90990000",
  "",
].join("\n");

describe("tax payment rules through the import", () => {
  beforeEach(resetDb);

  it("files a remittance to its liability, and skips a rule whose account the client's chart lacks", async () => {
    const g = await makeGroup();
    await db.account.deleteMany({ where: { clientId: g.client.id, code: "2141" } }); // an older chart without PPh 23
    await importStatement(db, { bankAccountId: g.pt.banks[0].id, fileName: "bca.csv", data: Buffer.from(CSV), provider: null });
    const t = async (text: string) => db.bankTransaction.findFirstOrThrow({ where: { description: { contains: text } } });
    expect(await t("PPH 21")).toMatchObject({ accountCode: "2140", taxTag: "PPH_21", status: "POSTED", method: "RULE" });
    expect(await t("BEA METERAI")).toMatchObject({ accountCode: "7100", status: "POSTED", method: "RULE" });
    const pph23 = await t("PPH 23"); // no 2141: the import still ran, the line waits in Review
    expect(pph23.status).toBe("NEEDS_REVIEW");
    expect(pph23.method).not.toBe("RULE");
  });
});

describe("tax payment rules migration", () => {
  beforeEach(resetDb);

  it("repoints an untouched seed PPh 21 rule, adds the missing rules once, and leaves the firm's own rules alone", async () => {
    const g = await makeGroup();
    const other = await db.firm.create({ data: { name: "Kantor Lama" } }); // an existing firm created before the rules
    await db.rule.createMany({
      data: [
        { firmId: other.id, pattern: "PPH 21", direction: "OUT", accountCode: "6100", taxTag: "PPH_21", priority: 15, source: "SEED" },
        { firmId: other.id, pattern: "PPH 23", direction: "OUT", accountCode: "6190", taxTag: null, priority: 5, source: "USER" }, // the firm's own choice
      ],
    });
    await db.rule.deleteMany({ where: { firmId: g.firm.id, pattern: { in: ["PPH 23", "METERAI"] } } });
    const sql = readFileSync(path.join(__dirname, "../../prisma/migrations/20260930050000_tax_payment_rules/migration.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (let run = 0; run < 2; run++) for (const s of statements) await db.$executeRawUnsafe(s); // idempotent
    const rule = (firmId: string, pattern: string) => db.rule.findMany({ where: { firmId, pattern, clientId: null } });
    expect((await rule(other.id, "PPH 21")).map((r) => r.accountCode)).toEqual(["2140"]);
    expect((await rule(other.id, "PPH 23")).map((r) => [r.accountCode, r.source])).toEqual([["6190", "USER"]]);
    expect((await rule(other.id, "PPH 4(2)")).map((r) => [r.accountCode, r.taxTag])).toEqual([["2145", "PPH_4_2"]]);
    expect((await rule(other.id, "METERAI")).length).toBe(1);
    expect((await rule(g.firm.id, "PPH 23")).map((r) => r.accountCode)).toEqual(["2141"]); // re-added for the firm that lacked it
  });
});

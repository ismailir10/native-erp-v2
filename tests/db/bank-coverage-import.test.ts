import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importStatement } from "@/lib/import/pipeline";
import { OnboardingError, setBankAccountBank } from "@/lib/onboarding";
import { mt940 } from "../bank-layouts";

describe("files from more banks, through the real import", () => {
  beforeEach(resetDb);

  it("imports an MT940 file, names its bank, and posts every line against the bank account", async () => {
    const g = await makeGroup();
    const bca = g.pt.banks[0];
    const summary = await importStatement(db, { bankAccountId: bca.id, fileName: "bca.mt940", data: mt940("CENAIDJA", "1111111111", { daily: true }), provider: null });
    expect(summary.fileBank).toBe("BCA");
    expect(summary.rows).toBe(5);
    expect(summary.continuityOk).toBe(true);
    const lines = await db.bankTransaction.findMany({ where: { bankAccountId: bca.id }, orderBy: { rowNumber: "asc" } });
    expect(lines.reduce((s, t) => s + t.amount, 0n)).toBe(38_080_678n);
    expect(await db.journalEntry.count({ where: { bankTransactionId: { in: lines.map((l) => l.id) } } })).toBe(5);
    // The same file again adds nothing.
    const again = await importStatement(db, { bankAccountId: bca.id, fileName: "bca-lagi.mt940", data: mt940("CENAIDJA", "1111111111", { daily: true }), provider: null });
    expect(again.rows - again.duplicates).toBe(0);
  });

  it("says which bank the file is from when it isn't the account's, and the account's bank can follow it", async () => {
    const g = await makeGroup();
    const acct = g.pt.banks[1]; // recorded at Mandiri
    const summary = await importStatement(db, { bankAccountId: acct.id, fileName: "x.mt940", data: mt940("BNIAIDJA", "2222222222"), provider: null });
    expect(summary.fileBank).toBe("CIMB");
    await setBankAccountBank(db, g.client.id, acct.id, "CIMB");
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: acct.id } })).bank).toBe("CIMB");
  });

  it("names the other account of a two-account MT940 by its bank, and says once it was imported to its own account", async () => {
    const g = await makeGroup();
    const [bca, mandiri] = g.pt.banks;
    const two = Buffer.from(mt940("CENAIDJA", "1111111111").toString() + "\n" + mt940("CENAIDJA", "2222222222").toString().replace(/^\{1:[^\n]*\n/, ""));
    const first = await importStatement(db, { bankAccountId: bca.id, fileName: "dua.mt940", data: two, provider: null });
    expect(first.otherSections).toEqual(["2222222222 BCA (IDR): tidak diimpor ke rekening ini"]);
    const second = await importStatement(db, { bankAccountId: mandiri.id, fileName: "dua.mt940", data: two, provider: null });
    expect(second.otherSections).toEqual(["1111111111 BCA (IDR): sudah diimpor ke BCA Giro"]);
  });

  it("changes the bank only of the client's own accounts, and only to a bank Buku knows", async () => {
    const g = await makeGroup();
    const other = await makeGroup();
    await expect(setBankAccountBank(db, g.client.id, other.pt.banks[0].id, "BNI")).rejects.toThrow(OnboardingError);
    await expect(setBankAccountBank(db, g.client.id, g.pt.banks[0].id, "BANKX")).rejects.toThrow("Pilih bank.");
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: other.pt.banks[0].id } })).bank).toBe("BCA");
  });
});

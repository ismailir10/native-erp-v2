import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../helpers";
import { smbcCombinedPdf } from "../pdf-fixture";
import { createFirm } from "@/lib/setup";
import { addClient } from "@/lib/onboarding";
import { importStatement } from "@/lib/import/pipeline";
import { AccountMismatchError } from "@/lib/import/types";
import { postJournal } from "@/lib/ledger/post";
import { runControls } from "@/lib/controls";
import { balanceSheet } from "@/lib/reports/ledger";
import { dateOnly } from "@/lib/format";

describe("SMBC combined statement + PRK overdraft account", () => {
  beforeEach(resetDb);

  it("imports each section into its own bank account; the PRK account is a liability that reconciles", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA"));
    const client = await addClient(db, firm.id, {
      name: "Pak Alfi",
      industry: "",
      entities: [
        {
          name: "Alfi",
          shortName: "Alfi",
          kind: "PERORANGAN",
          npwp: "",
          banks: [
            { bank: "SMBC", number: "90022152088", label: "Jenius" },
            { bank: "SMBC", number: "05243002879", label: "", isOverdraft: true },
          ],
        },
      ],
    });
    const banks = await db.bankAccount.findMany({ where: { entity: { clientId: client.id } }, include: { account: true }, orderBy: { number: "desc" } });
    expect(banks.map((b) => [b.number, b.isOverdraft, b.account.code, b.account.type, b.label])).toEqual([
      ["90022152088", false, "1101", "ASET", "Jenius"],
      ["05243002879", true, "2201", "LIABILITAS", "SMBC PRK ••2879"],
    ]);
    const [jenius, prk] = banks;
    const pdf = smbcCombinedPdf();
    const s1 = await importStatement(db, { bankAccountId: jenius.id, fileName: "smbc.pdf", data: pdf, provider: null });
    expect(s1).toMatchObject({ rows: 2, continuityOk: true });
    expect(s1.otherSections).toEqual([
      "05243002879 Pinjaman Rekening Koran BTB (IDR): tidak diimpor ke rekening ini",
      "90022164251 JENIUS JPY ACCOUNT (JPY): tidak diimpor ke rekening ini",
    ]);
    expect(s1.otherAccounts).toEqual([
      { number: "05243002879", label: "Pinjaman Rekening Koran BTB", currency: "IDR", imported: false },
      { number: "90022164251", label: "JENIUS JPY ACCOUNT", currency: "JPY", imported: false },
    ]);
    const s2 = await importStatement(db, { bankAccountId: prk.id, fileName: "smbc.pdf", data: pdf, provider: null });
    expect(s2).toMatchObject({ rows: 2, continuityOk: true });
    // Jenius already holds this month from the file: no "Impor juga ke Jenius" after the PRK import.
    expect(s2.otherAccounts.find((o) => o.number === "90022152088")?.imported).toBe(true);
    // The same file again: nothing new, no second history row, the existing import is named.
    const imports = await db.statementImport.count();
    const again = await importStatement(db, { bankAccountId: prk.id, fileName: "smbc.pdf", data: pdf, provider: null });
    expect([again.importId, again.duplicates, again.needsReview, await db.statementImport.count()]).toEqual([s2.importId, 2, 0, imports]);
    expect(again.pendingReview).toBe(await db.bankTransaction.count({ where: { status: "NEEDS_REVIEW" } }));

    // Opening: the overdraft is owed to the bank (credit on 2201).
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: client.id, code } } })).id;
    const entity = (await db.entity.findFirstOrThrow({ where: { clientId: client.id } })).id;
    await db.$transaction(async (tx) =>
      postJournal(tx, {
        entityId: entity,
        date: dateOnly(2026, 4, 30),
        kind: "OPENING",
        memo: "Saldo awal",
        lines: [
          { accountId: jenius.accountId, debit: 5_646_633n },
          { accountId: prk.accountId, credit: 3_598_843_911n },
          { accountId: await acc("3200"), debit: 3_593_197_278n },
        ],
      }),
    );
    const controls = await runControls(db, client.id, 2026, 5);
    expect(controls.filter((c) => c.key.startsWith("bank:")).map((c) => [c.status, c.detail]).sort()).toEqual([
      ["PASS", "Saldo bank = buku besar = -Rp 3.581.066.684"],
      ["PASS", "Saldo bank = buku besar = Rp 220.646.633"],
    ]);
    const bs = await balanceSheet(db, { clientId: client.id, entityIds: [entity] }, dateOnly(2026, 5, 31));
    expect(bs.liabilities.find((i) => i.fsLine === "UTANG_BANK")?.amount).toBe(3_581_066_684n);
  });

  it("refuses a combined file without the selected account", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA"));
    const client = await addClient(db, firm.id, { name: "X", industry: "", entities: [{ name: "X", shortName: "X", kind: "PT", npwp: "", banks: [{ bank: "SMBC", number: "11112222333", label: "" }] }] });
    const bank = await db.bankAccount.findFirstOrThrow({ where: { entity: { clientId: client.id } } });
    await expect(importStatement(db, { bankAccountId: bank.id, fileName: "smbc.pdf", data: smbcCombinedPdf(), provider: null })).rejects.toThrow(/berisi 3 rekening.*tidak ada nomor 11112222333/);
  });
  it("names the file's account when it isn't the selected one", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA"));
    const client = await addClient(db, firm.id, { name: "Uji", industry: "", entities: [{ name: "Uji", shortName: "Uji", kind: "PERORANGAN", npwp: "", banks: [{ bank: "SMBC", number: "1111111111", label: "Lain" }] }] });
    const bank = await db.bankAccount.findFirstOrThrow({ where: { entity: { clientId: client.id } } });
    const err = await importStatement(db, { bankAccountId: bank.id, fileName: "smbc.pdf", data: smbcCombinedPdf(), provider: null }).catch((e) => e);
    expect(err).toBeInstanceOf(AccountMismatchError);
    expect(err.fileNumbers).toEqual(["90022152088", "05243002879", "90022164251"]);
  });
});

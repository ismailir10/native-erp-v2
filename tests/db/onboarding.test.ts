import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../helpers";
import { addClient, OnboardingError, validateNewClient, type NewClientInput } from "@/lib/onboarding";
import { createFirm } from "@/lib/setup";

const input = (): NewClientInput => ({
  name: "Grup Maju",
  industry: "distributor",
  entities: [
    { name: "Budi Santoso", shortName: "Budi", kind: "PERORANGAN", npwp: "", banks: [{ bank: "BRI", number: "0123-01-004455-50-9", label: "BRI Simpedes" }] },
    { name: "PT Maju Bersama", shortName: "", kind: "PT", npwp: "01.234.567.8-015.000", banks: [{ bank: "BCA", number: "8720145566", label: "BCA Giro" }, { bank: "MANDIRI", number: "1370098765432", label: "Mandiri Giro" }] },
  ],
});

describe("Tambah klien", () => {
  beforeEach(resetDb);

  it("creates entities (companies first), bank GL accounts and the template COA", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA Uji"));
    const client = await addClient(db, firm.id, input());
    const entities = await db.entity.findMany({ where: { clientId: client.id }, include: { bankAccounts: { include: { account: true } } }, orderBy: { name: "asc" } });
    expect(entities.map((e) => [e.kind, e.shortName])).toEqual([["PERORANGAN", "Budi"], ["PT", "PT Maju Bersama"]]);
    const banks = entities.flatMap((e) => e.bankAccounts).sort((a, b) => a.account.code.localeCompare(b.account.code));
    expect(banks.map((b) => [b.account.code, b.number])).toEqual([
      ["1101", "8720145566"],
      ["1102", "1370098765432"],
      ["1103", "012301004455509"],
    ]);
    expect(await db.account.count({ where: { clientId: client.id, code: { in: ["1190", "1199", "1999", "3200"] } } })).toBe(4);
  });

  it("reports every problem at once, keyed by field", () => {
    const bad = input();
    bad.name = " ";
    bad.entities[0].name = "";
    bad.entities[0].banks[0].number = "12ab";
    bad.entities[1].banks[1].number = "8720145566"; // duplicate of the row above
    bad.entities[1].npwp = "123";
    let err: OnboardingError | null = null;
    try {
      validateNewClient(bad);
    } catch (e) {
      err = e as OnboardingError;
    }
    expect(err).toBeInstanceOf(OnboardingError);
    expect(err!.fields).toEqual({
      name: "Isi nama klien.",
      "entities.0.name": "Isi nama pemilik.",
      "entities.0.banks.0.number": "Nomor rekening berisi 6–20 angka.",
      "entities.1.npwp": "NPWP berisi 15 atau 16 angka, boleh dengan titik dan strip.",
      "entities.1.banks.1.number": "Nomor ini sudah dimasukkan di atas.",
    });
    expect(err!.message).toBe("Periksa 5 isian yang ditandai.");
    const badCurrency = input();
    badCurrency.entities[0].currency = "XYZ";
    expect(() => validateNewClient(badCurrency)).toThrow("Pilih mata uang dari daftar.");
  });

  it("only needs client name, entity name and account number", () => {
    const spec = validateNewClient({
      name: "Toko Maju",
      industry: "",
      entities: [{ name: "PT Toko Maju", shortName: "", kind: "PT", npwp: "", banks: [{ bank: "BCA", number: "872 014 5566", label: "" }] }],
    });
    expect(spec.entities[0]).toMatchObject({ shortName: "PT Toko Maju", npwp: undefined, functionalCurrency: "IDR", banks: [{ bank: "BCA", number: "8720145566", label: "BCA ••5566" }] });
  });

  it("allows an entity without bank accounts, in its own currency (ledger clients, foreign HoldCo)", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA"));
    const client = await addClient(db, firm.id, {
      name: "Grup Chickin",
      industry: "agritech",
      entities: [
        { name: "PT Sinergi", shortName: "SKP", kind: "PT", npwp: "", banks: [] },
        { name: "Chickin Pte Ltd", shortName: "HOLDCO", kind: "PT", npwp: "", currency: "SGD", banks: [] },
      ],
    });
    const entities = await db.entity.findMany({ where: { clientId: client.id }, orderBy: { shortName: "asc" } });
    expect(entities.map((e) => [e.shortName, e.functionalCurrency])).toEqual([["HOLDCO", "SGD"], ["SKP", "IDR"]]);
    expect(await db.bankAccount.count()).toBe(0);
  });
});

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

  it("accepts every bank Buku knows, names a blank account after the bank's short name, and refuses an unknown code", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA Uji"));
    const many = input();
    many.entities[1].banks = [
      { bank: "BNI", number: "0123456789", label: "" },
      { bank: "JAGO", number: "100200300400", label: "Jago Operasional" },
      { bank: "SMBC", number: "90022152088", label: "" },
    ];
    const client = await addClient(db, firm.id, many);
    const rows = await db.bankAccount.findMany({ where: { entity: { clientId: client.id } }, orderBy: { number: "asc" } });
    expect(rows.map((b) => [b.bank, b.label])).toEqual([
      ["BRI", "BRI Simpedes"],
      ["BNI", "BNI ••6789"],
      ["JAGO", "Jago Operasional"],
      ["SMBC", "SMBC ••2088"],
    ]);
    const bad = input();
    (bad.entities[0].banks[0] as { bank: string }).bank = "BANKX";
    expect(() => validateNewClient(bad)).toThrow("Pilih bank.");
  });

  it("stores each entity's reporting framework, SAK EP when none is chosen, and rejects an unknown one", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KJA Uji"));
    const withFramework = input();
    withFramework.entities[0].reportingFramework = "SAK_EMKM";
    const client = await addClient(db, firm.id, withFramework);
    const rows = await db.entity.findMany({ where: { clientId: client.id }, orderBy: { name: "asc" } });
    expect(rows.map((e) => [e.shortName, e.reportingFramework])).toEqual([["Budi", "SAK_EMKM"], ["PT Maju Bersama", "SAK_EP"]]);
    const bad = input();
    (bad.entities[1] as { reportingFramework?: string }).reportingFramework = "IFRS";
    expect(() => validateNewClient(bad)).toThrow("Pilih kerangka pelaporan.");
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

  it("ignores a bank row left completely empty (the form starts with one), not one that is half filled", () => {
    const blank = { bank: "BCA" as const, number: "", label: "" };
    const spec = validateNewClient({
      name: "Toko Maju",
      industry: "",
      entities: [{ name: "PT Toko Maju", shortName: "", kind: "PT", npwp: "", banks: [blank, { bank: "BCA", number: "872 014 5566", label: "" }, { ...blank, number: "   " }] }],
    });
    expect(spec.entities[0].banks.map((b) => b.number)).toEqual(["8720145566"]);
    expect(validateNewClient({ name: "Toko Maju", industry: "", entities: [{ name: "PT Toko Maju", shortName: "", kind: "PT", npwp: "", banks: [blank] }] }).entities[0].banks).toEqual([]);

    // A label or the PRK box without a number is a real mistake: named on the row that is shown (index kept, blanks included).
    const half = { name: "Toko Maju", industry: "", entities: [{ name: "PT Toko Maju", shortName: "", kind: "PT" as const, npwp: "", banks: [blank, { ...blank, label: "Giro utama" }, { ...blank, isOverdraft: true }] }] };
    let err: OnboardingError | null = null;
    try {
      validateNewClient(half);
    } catch (e) {
      err = e as OnboardingError;
    }
    expect(err?.fields).toEqual({ "entities.0.banks.1.number": "Isi nomor rekening.", "entities.0.banks.2.number": "Isi nomor rekening." });
  });
});

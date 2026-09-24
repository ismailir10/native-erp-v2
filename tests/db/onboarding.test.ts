import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../helpers";
import { addClient, OnboardingError, validateNewClient, type NewClientInput } from "@/lib/onboarding";
import { createFirm } from "@/lib/setup";
import { getCurrentFirm } from "@/lib/tenant";

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

  it("rejects missing names, bad or duplicate account numbers", () => {
    expect(() => validateNewClient({ ...input(), name: " " })).toThrow("Isi nama klien.");
    const dup = input();
    dup.entities[1].banks[1].number = "8720145566";
    expect(() => validateNewClient(dup)).toThrow(/dua kali/);
    const bad = input();
    bad.entities[0].banks[0].number = "12ab";
    expect(() => validateNewClient(bad)).toThrow(OnboardingError);
    const noBank = input();
    noBank.entities[0].banks = [];
    expect(() => validateNewClient(noBank)).toThrow(/minimal satu rekening/);
  });
});

describe("first visit on a real-data deployment", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  it("creates one empty firm, even under concurrent first requests", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const [a, b] = await Promise.all([getCurrentFirm(), getCurrentFirm()]);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("Kantor Anda");
    expect(await db.firm.count()).toBe(1);
  });

  it("never creates a firm in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(getCurrentFirm()).rejects.toThrow(/demo:reset/);
    expect(await db.firm.count()).toBe(0);
  });
});

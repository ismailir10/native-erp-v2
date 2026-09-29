import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { importCensus, qxOf, readMortality, saveBenefitSetting, saveEmployee, uploadMortality } from "@/lib/benefits/census";
import { workbook } from "../xls-fixture";
import { CENSUS_CSV, mortalityCsv, syntheticQx } from "../benefits-fixture";

describe("PSAK 24 inputs", () => {
  beforeEach(resetDb);

  it("imports a census from CSV (wage = basic + fixed allowance) and updates it from Excel by number", async () => {
    const g = await makeGroup();
    const base = { clientId: g.client.id, entityId: g.pt.entity.id };
    expect(await importCensus(db, { ...base, fileName: "sensus.csv", data: Buffer.from(CENSUS_CSV) })).toEqual({ added: 4, updated: 0 });
    const budi = await db.employee.findFirstOrThrow({ where: { employeeNo: "K-001" } });
    expect(budi).toMatchObject({ name: "Budi Santoso", sex: "MALE", wage: 10_000_000n, leftOn: null });
    expect(budi.birthDate.toISOString().slice(0, 10)).toBe("1975-03-15");
    expect((await db.employee.findFirstOrThrow({ where: { employeeNo: "K-004" } })).leftOn?.toISOString().slice(0, 10)).toBe("2026-06-30");

    const xlsx = workbook([{ name: "Karyawan", rows: [
      ["Daftar karyawan PT Uji"],
      ["NIK", "Nama Karyawan", "Jenis Kelamin", "Tgl Lahir", "Tanggal Masuk", "Upah"],
      ["K-001", "Budi Santoso", "Laki-laki", { date: "1975-03-15" }, { date: "2005-02-01" }, 11_000_000],
      ["K-005", "Dewi Anggraini", "Perempuan", { date: "1995-04-01" }, { date: "2026-02-01" }, 5_500_000],
    ] }], "xlsx");
    expect(await importCensus(db, { ...base, fileName: "sensus.xlsx", data: xlsx })).toEqual({ added: 1, updated: 1 });
    expect((await db.employee.findFirstOrThrow({ where: { employeeNo: "K-001" } })).wage).toBe(11_000_000n);
    expect(await db.employee.count()).toBe(5);
  });

  it("names every unreadable row and imports none of them", async () => {
    const g = await makeGroup();
    const bad = ["Nama;JK;Tanggal Lahir;Tanggal Masuk;Upah", "A;X;01/01/1990;01/01/2020;5000000", "B;L;01/01/2020;01/01/1990;5000000", "C;P;01/01/1990;01/01/2020;0", ""].join("\n");
    await expect(importCensus(db, { clientId: g.client.id, entityId: g.pt.entity.id, fileName: "s.csv", data: Buffer.from(bad) })).rejects.toThrow(/3 baris sensus.*Baris 2 \(A\): jenis kelamin.*Baris 3 \(B\): tanggal masuk sebelum.*Baris 4 \(C\): upah harus/);
    await expect(importCensus(db, { clientId: g.client.id, entityId: g.pt.entity.id, fileName: "s.csv", data: Buffer.from("Nama;Umur\nA;30\n") })).rejects.toThrow(/Kolom sensus tidak ditemukan/);
    expect(await db.employee.count()).toBe(0);
    await expect(saveEmployee(db, { clientId: g.client.id, entityId: g.pt.entity.id, name: "D", sex: "MALE", birthDate: "1990-02-30", hireDate: "2020-01-01", wage: "5.000.000" })).rejects.toThrow(/Tanggal lahir tidak valid/);
  });

  it("uploads a mortality table and checks its ages", async () => {
    const g = await makeGroup();
    const t = await uploadMortality(db, { firmId: g.firm.id, name: "Tabel uji", fileName: "tmi.csv", data: mortalityCsv() });
    expect(t.male).toHaveLength(112);
    expect(qxOf(t)(40, "MALE")).toBeCloseTo(syntheticQx(40, false), 9);
    expect(qxOf(t)(150, "FEMALE")).toBeCloseTo(syntheticQx(111, true), 9);
    await expect(readMortality("t.csv", mortalityCsv(80))).rejects.toThrow(/sedikitnya 99/);
    await expect(readMortality("t.csv", Buffer.from("Usia;Pria;Wanita\n0;0,1;0,1\n2;0,1;0,1\n"))).rejects.toThrow(/tidak berurutan/);
    await expect(readMortality("t.csv", Buffer.from("Usia;Pria;Wanita\n0;1,5;0,1\n"))).rejects.toThrow(/qx usia 0 harus angka 0–1/);
    const s = await saveBenefitSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, mortalityTableId: t.id, discount: "7,25", salary: "5", retirementAge: 56, disability: "10", resign: "5", resignFlatUntil: 30, resignZeroAge: 55 });
    expect(s).toMatchObject({ discountBp: 725, salaryBp: 500, disabilityBp: 1000, resignBp: 500 });
    await expect(saveBenefitSetting(db, { clientId: g.client.id, entityId: g.pt.entity.id, mortalityTableId: null, discount: "7", salary: "5", retirementAge: 56, disability: "10", resign: "5", resignFlatUntil: 50, resignZeroAge: 40 })).rejects.toThrow(/mulai turun: 15–40/);
  });
});

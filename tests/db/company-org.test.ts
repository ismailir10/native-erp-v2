import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../helpers";
import { createClient, createFirm } from "@/lib/setup";
import { addClient } from "@/lib/onboarding";
import { deleteClient, DeleteClientError } from "@/lib/clients/delete";
import { companyClient, OrgError } from "@/lib/org";

const entities = [{ name: "PT Maju Bersama", shortName: "Maju", kind: "PT" as const, banks: [] }, { name: "PT Maju Logistik", shortName: "Logistik", kind: "PT" as const, banks: [] }];

describe("a company organisation keeps exactly one set of books (T12)", () => {
  beforeEach(resetDb);

  it("takes its first client, refuses a second through every path, and never deletes it", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "PT Maju Bersama", { kind: "PERUSAHAAN" }));
    const { client } = await db.$transaction((tx) => createClient(tx, firm.id, { name: "PT Maju Bersama", industry: "distribusi", entities }));
    expect(await companyClient(db, firm)).toMatchObject({ id: client.id });
    await expect(db.$transaction((tx) => createClient(tx, firm.id, { name: "Lain", industry: "jasa", entities: [] }))).rejects.toBeInstanceOf(OrgError);
    await expect(addClient(db, firm.id, { name: "Lain", industry: "jasa", entities: [{ name: "PT Lain", shortName: "Lain", kind: "PT", npwp: "", banks: [{ bank: "BCA", number: "1234567890", label: "BCA Giro" }] }] })).rejects.toThrow("Perusahaan memiliki satu buku");
    await expect(deleteClient(db, { firmId: firm.id, clientId: client.id, confirmName: "PT Maju Bersama" })).rejects.toBeInstanceOf(DeleteClientError);
    expect(await db.client.count({ where: { firmId: firm.id } })).toBe(1);
  });

  it("an accounting firm still adds as many clients as it likes", async () => {
    const firm = await db.$transaction((tx) => createFirm(tx, "KAP Banyak"));
    for (const name of ["Satu", "Dua", "Tiga"]) await db.$transaction((tx) => createClient(tx, firm.id, { name, industry: "jasa", entities: [] }));
    expect(await db.client.count({ where: { firmId: firm.id } })).toBe(3);
    expect(await companyClient(db, firm)).toBeNull();
  });
});

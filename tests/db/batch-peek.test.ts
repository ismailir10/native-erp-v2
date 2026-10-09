import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { briInternetBankingCsv, titleWithCommasSemicolonCsv } from "../bank-fixture";
import { makePdf, smbcCombinedPdf } from "../pdf-fixture";
import { unknownCsv } from "../unknown-layout";
import { peekStatement } from "@/lib/import/peek";
import { createClient, createFirm } from "@/lib/setup";

async function oneAccountClient(banks: { bank: "BCA" | "SMBC"; number: string; label: string }[]) {
  const firm = await db.$transaction((tx) => createFirm(tx, "KJA Satu"));
  const { client, entities } = await db.$transaction((tx) => createClient(tx, firm.id, { name: "Klien Satu", industry: "retail", entities: [{ name: "PT Satu Fiktif", shortName: "PT Satu", kind: "PT", banks }] }));
  return { client, banks: entities[0].banks };
}

describe("peekStatement", () => {
  beforeEach(resetDb);

  it("matches a file to the client's account by its number and writes nothing", async () => {
    const g = await makeGroup();
    await db.bankAccount.update({ where: { id: g.owner.banks[0].id }, data: { number: "0000-01-000123-50-9" } });
    const r = await peekStatement(db, { clientId: g.client.id, fileName: "bri.csv", data: briInternetBankingCsv() });
    expect(r).toMatchObject({ ok: true, fileBank: "GENERIC" });
    if (!r.ok) throw new Error();
    expect(r.lines).toEqual([{ number: "000001000123509", label: "", currency: "IDR", bankAccountId: g.owner.banks[0].id, periodStart: "2026-08-01", periodEnd: "2026-08-31", rows: 5, status: "READY" }]);
    expect(await db.statementImport.count()).toBe(0);
    expect(await db.bankTransaction.count()).toBe(0);
    expect(await db.journalEntry.count()).toBe(0);
  });

  it("says when a number belongs to none of the client's accounts", async () => {
    const g = await makeGroup();
    const r = await peekStatement(db, { clientId: g.client.id, fileName: "bri.csv", data: briInternetBankingCsv() });
    if (!r.ok) throw new Error();
    expect(r.lines[0]).toMatchObject({ status: "NO_ACCOUNT", bankAccountId: null, number: "000001000123509" });
    expect(r.lines[0].note).toMatch(/bukan rekening klien ini/);
  });

  it("splits a combined file into its accounts: matched, not this client's, foreign currency", async () => {
    const { client, banks } = await oneAccountClient([{ bank: "SMBC", number: "90022152088", label: "Jenius" }]);
    const r = await peekStatement(db, { clientId: client.id, fileName: "smbc.pdf", data: smbcCombinedPdf() });
    if (!r.ok) throw new Error();
    expect(r.lines.map((l) => [l.number, l.currency, l.status, l.bankAccountId])).toEqual([
      ["90022152088", "IDR", "READY", banks[0].id],
      ["05243002879", "IDR", "NO_ACCOUNT", null],
      ["90022164251", "JPY", "FOREIGN", null],
    ]);
  });

  it("pairs a file with no number to the only account, or asks when there are several", async () => {
    const one = await oneAccountClient([{ bank: "BCA", number: "7777777777", label: "BCA" }]);
    const a = await peekStatement(db, { clientId: one.client.id, fileName: "kas.csv", data: titleWithCommasSemicolonCsv() });
    if (!a.ok) throw new Error(a.error);
    expect(a.lines[0].number).toBeNull();
    expect(a.lines[0]).toMatchObject({ status: "READY", bankAccountId: one.banks[0].id });
    expect(a.lines[0].note).toMatch(/satu-satunya rekening/);

    const g = await makeGroup();
    const b = await peekStatement(db, { clientId: g.client.id, fileName: "kas.csv", data: titleWithCommasSemicolonCsv() });
    if (!b.ok) throw new Error(b.error);
    expect(b.lines[0]).toMatchObject({ status: "PICK", bankAccountId: null });
  });

  it("names what the accountant must answer: password, a file no reader knows, a scan", async () => {
    const g = await makeGroup();
    const locked = makePdf([[{ x: 40, y: 800, text: "tidak dibaca" }]], { userPassword: "rahasia" });
    expect(await peekStatement(db, { clientId: g.client.id, fileName: "a.pdf", data: locked })).toMatchObject({ ok: false, kind: "PASSWORD" });
    expect(await peekStatement(db, { clientId: g.client.id, fileName: "kas.csv", data: unknownCsv(8) })).toMatchObject({ ok: false, kind: "UNREADABLE" });
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    expect(await peekStatement(db, { clientId: g.client.id, fileName: "foto.png", data: png })).toMatchObject({ ok: false, kind: "SCAN" });
  });
});

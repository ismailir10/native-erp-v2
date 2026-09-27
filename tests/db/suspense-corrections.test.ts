import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { acceptCheck, importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { runControls } from "@/lib/controls";
import { correctionViews, postSuspenseCorrection, suspenseCorrections } from "@/lib/adjust/suspense";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

/** One ledger group that doesn't balance, accepted: its difference goes to 1999 (rule 15a). */
async function unbalanced(rows: [string, string, number, number][]) {
  const g = await makeGroup();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GL");
  ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Debit", "Credit"]);
  for (const [code, name, dr, cr] of rows) ws.addRow(["PT Uji", new Date(Date.UTC(2026, 0, 31)), code, name, dr, cr]);
  const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
  if (st.status !== "STAGED") throw new Error("not staged");
  for (const c of await db.importCheck.findMany({ where: { ledgerImportId: st.importId, code: "UNBALANCED" } })) await acceptCheck(db, g.client.id, c.id);
  await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
  const src = await importSourceAccounts(db, st.importId);
  await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.suggestedCode!, method: s.suggestedBy! })));
  await postImport(db, g.client.id, st.importId);
  const control = async () => (await runControls(db, g.client.id, 2026, 1)).find((c) => c.key === `ledger:${st.importId}`)!;
  const suspenseNet = async () => {
    const s = await db.journalLine.aggregate({ where: { entityId: g.pt.entity.id, account: { code: "1999" } }, _sum: { debit: true, credit: true } });
    return (s._sum.debit ?? 0n) - (s._sum.credit ?? 0n);
  };
  return { g, control, suspenseNet };
}

describe("1999 corrections for ledger-file differences", () => {
  beforeEach(resetDb);

  it("prefills the counter account when one line of the group has the difference's amount, and posting clears the FAIL", async () => {
    const { g, control, suspenseNet } = await unbalanced([["10000", "Kas", 100, 0], ["21001", "Income Tax Payable - Art 21", 0, 100], ["21002", "Smartfarm Payable", 0, 5]]);
    expect(await suspenseNet()).toBe(5n);
    expect((await control()).status).toBe("FAIL");
    expect((await control()).detail).toMatch(/koreksi lewat Usulan jurnal koreksi di Tutup Buku/);
    const [c] = await suspenseCorrections(db, g.client.id, 2026, 1);
    const smartfarm = await db.journalLine.findFirstOrThrow({ where: { entityId: g.pt.entity.id, credit: 5n, account: { isSuspense: false } }, include: { account: true } });
    expect(c.lines).toEqual([{ accountCode: "1999", debit: "0", credit: "5" }, { accountCode: smartfarm.account.code, debit: "5", credit: "0" }]);
    expect(c.reason).toMatch(/kemungkinan tercatat ganda/);
    expect((await correctionViews(db, g.client.id, 2026, 1)).map((v) => [v.source, v.fixed])).toEqual([["SUSPENSE", 0]]);

    await expect(postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: ["2120", smartfarm.account.code] })).rejects.toThrow("Baris 1999");
    const entry = await postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: c.lines.map((l) => l.accountCode) });
    expect(entry.kind).toBe("ADJUSTMENT");
    // The correction keeps the imported group's file and rows (rule 15): report numbers still drill to their source.
    const imported = await db.journalEntry.findFirstOrThrow({ where: { entityId: g.pt.entity.id, ledgerImportId: { not: null }, kind: "IMPORTED" } });
    expect([entry.ledgerImportId, entry.sourceRef]).toEqual([imported.ledgerImportId, imported.sourceRef]);
    expect(await suspenseNet()).toBe(0n);
    expect((await control()).status).not.toBe("FAIL");
    expect(await suspenseCorrections(db, g.client.id, 2026, 1)).toEqual([]);
    await expect(postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: c.lines.map((l) => l.accountCode) })).rejects.toThrow("sudah diputuskan");
  });

  it("offers nothing, and posts nothing, for a difference already cleared by a manual adjustment", async () => {
    const { g, control, suspenseNet } = await unbalanced([["10000", "Kas", 100, 0], ["21001", "Income Tax Payable - Art 21", 0, 100], ["21002", "Smartfarm Payable", 0, 5]]);
    const [c] = await suspenseCorrections(db, g.client.id, 2026, 1);
    const account = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    // Cleared the old way, before these proposals existed: a manual adjustment against 1999.
    const debit1999 = c.lines[0].debit !== "0";
    await db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 31), kind: "ADJUSTMENT", memo: "koreksi manual", lines: [
      { accountId: await account("1999"), debit: debit1999 ? 5n : 0n, credit: debit1999 ? 0n : 5n },
      { accountId: await account("2120"), debit: debit1999 ? 0n : 5n, credit: debit1999 ? 5n : 0n },
    ] }));
    expect([await suspenseNet(), (await control()).status === "FAIL"]).toEqual([0n, false]);
    expect(await suspenseCorrections(db, g.client.id, 2026, 1)).toEqual([]);
    await expect(postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: ["1999", "2120"] })).rejects.toThrow();
    expect(await suspenseNet()).toBe(0n); // never reversed a second time
  });

  it("leaves the counter account to the accountant when no single line explains it, and the FAIL stays until it is corrected", async () => {
    const { g, control, suspenseNet } = await unbalanced([["21001", "Income Tax Payable - Art 21", 0, 100], ["10000", "Kas", 90, 0], ["21002", "Smartfarm Payable", 0, 5]]);
    const [c] = await suspenseCorrections(db, g.client.id, 2026, 1);
    expect([c.lines[1].accountCode, c.lines[1].debit, c.reason]).toEqual(["", "15", "Pilih akun lawan untuk selisih grup GL!2-4"]);
    await expect(postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: ["1999", ""] })).rejects.toThrow("Pilih akun");
    // A post that fails after the draft is stored (locked month) leaves the line proposed, shown once.
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 1 } }, data: { status: "LOCKED" } });
    await expect(postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: ["1999", "2120"] })).rejects.toThrow("sudah ditutup");
    expect((await correctionViews(db, g.client.id, 2026, 1)).map((v) => v.id)).toEqual([`suspense:${c.lineId}`]);
    await db.period.update({ where: { clientId_year_month: { clientId: g.client.id, year: 2026, month: 1 } }, data: { status: "OPEN" } });
    // Nothing but a posted correction hides it (a 1999 difference can't be dismissed), and the close keeps failing till then.
    expect([await suspenseNet(), (await control()).status]).toEqual([15n, "FAIL"]);
    expect((await suspenseCorrections(db, g.client.id, 2026, 1)).map((x) => x.lineId)).toEqual([c.lineId]);
    await postSuspenseCorrection(db, { firmId: g.firm.id, clientId: g.client.id, lineId: c.lineId, accounts: ["1999", "2120"] });
    expect([await suspenseNet(), (await control()).status === "FAIL"]).toEqual([0n, false]);
  });
});

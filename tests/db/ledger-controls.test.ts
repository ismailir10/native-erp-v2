import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { acceptCheck, importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { runControls } from "@/lib/controls";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

describe("close control: Impor buku besar", () => {
  beforeEach(resetDb);

  it("is FAIL while an accepted source difference sits in 1999, REVIEW for findings, then clears", async () => {
    const g = await makeGroup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("GL");
    ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Debit", "Credit"]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 0, 31)), "21001", "Income Tax Payable - Art 21", 0, 100]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 0, 31)), "10000", "Kas", 90, 0]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2026, 0, 31)), "21001", "Smartfarm Payable", 0, 5]);
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "gl.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    if (st.status !== "STAGED") throw new Error("not staged");
    for (const c of await db.importCheck.findMany({ where: { ledgerImportId: st.importId, code: "UNBALANCED" } })) await acceptCheck(db, g.client.id, c.id);
    await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, st.importId);
    await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.suggestedCode!, method: s.suggestedBy! })));
    await postImport(db, g.client.id, st.importId);

    const control = async () => (await runControls(db, g.client.id, 2026, 1)).find((c) => c.key === `ledger:${st.importId}`)!;
    const before = await control();
    expect(before.status).toBe("FAIL");
    expect(before.detail).toMatch(/1 selisih dari file sumber masih di 1999/);
    expect(before.detail).toMatch(/1 temuan perlu dicek/);
    expect(before.href).toBe(`/clients/${g.client.id}/import/ledger/${st.importId}`);
    expect(await (async () => (await runControls(db, g.client.id, 2026, 2)).some((c) => c.key === `ledger:${st.importId}`))()).toBe(false);

    // The accountant fixes the source difference with a Jurnal Penyesuaian → only the REVIEW finding is left.
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    const suspense = await db.journalLine.aggregate({ where: { entityId: g.pt.entity.id, account: { code: "1999" } }, _sum: { debit: true, credit: true } });
    const net = (suspense._sum.debit ?? 0n) - (suspense._sum.credit ?? 0n);
    await db.$transaction(async (tx) =>
      postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2026, 1, 31), kind: "ADJUSTMENT", memo: "Koreksi selisih sumber", lines: [{ accountId: await acc("1999"), credit: net > 0n ? net : 0n, debit: net < 0n ? -net : 0n }, { accountId: await acc("2120"), debit: net > 0n ? net : 0n, credit: net < 0n ? -net : 0n }] }),
    );
    const after = await control();
    expect(after.status).toBe("REVIEW");
    expect(after.detail).toMatch(/1 selisih sumber sudah dikoreksi/);
  });
});

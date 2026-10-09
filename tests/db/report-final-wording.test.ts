import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";
import { financialNotes } from "@/lib/reports/notes";
import { financialStatementsWorkbook } from "@/lib/reports/workbook";

/** A set that may go out final reads as one: no "(draf)" in its CALK subtitle, and no instruction to the app's user in its tax note. */
describe("final set wording", () => {
  beforeEach(resetDb);

  async function books() {
    const g = await makeGroup();
    const id = async (code: string) => (await db.account.findFirstOrThrow({ where: { clientId: g.client.id, code } })).id;
    const journal = async (date: Date, dr: string, cr: string, amount: bigint) =>
      db.$transaction(async (tx) => postJournal(tx, { entityId: g.pt.entity.id, date, kind: "ADJUSTMENT", memo: "uji", lines: [{ accountId: await id(dr), debit: amount }, { accountId: await id(cr), credit: amount }] }));
    await journal(dateOnly(2026, 3, 31), "1130", "4100", 1_000_000_000n);
    await journal(dateOnly(2026, 4, 30), "6100", "1110", 400_000_000n);
    return { clientId: g.client.id, entityIds: [g.pt.entity.id] };
  }

  it("the unbooked income tax is disclosed, not an instruction", async () => {
    const scope = await books();
    const tax = (await financialNotes(db, scope, 2026, 9)).notes.find((n) => n.title === "Pajak penghasilan")!;
    expect(tax.paragraphs).toContain("Beban pajak penghasilan kini periode ini belum dicatat dalam laporan laba rugi dan laporan posisi keuangan; estimasinya disajikan di bawah.");
    expect(tax.paragraphs.join(" ")).not.toMatch(/Catat jurnalnya|sebelum laporan ini final/);
  });

  it("the workbook's CALK subtitle says draf only while the set is a draft", async () => {
    const scope = await books();
    const subtitle = async (draft?: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await financialStatementsWorkbook(db, scope, 2026, 9, { firm: "KJA Uji", title: "PT Uji", draft }) as unknown as ArrayBuffer);
      return String(wb.getWorksheet("CALK")!.getCell("A3").value);
    };
    expect(await subtitle()).toBe("Per 30 September 2026 dan untuk periode yang berakhir pada tanggal tersebut");
    expect(await subtitle("1 transaksi masih di Review")).toBe("Per 30 September 2026 dan untuk periode yang berakhir pada tanggal tersebut (draf)");
  });
});

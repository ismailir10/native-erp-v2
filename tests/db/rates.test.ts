import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { averageRate, closingRate, lookupRate, rateNeeds, RateError, upsertFileRate, upsertRate, validateRateInput, type RateRow } from "@/lib/fx/rates";
import { formatRateId, normalizeRateInput } from "@/lib/fx/currency";
import { importSourceAccounts, postImport, stageImport } from "@/lib/ledger-import/post";
import { acceptMappings, suggestMappings } from "@/lib/ledger-import/mapping";
import { postJournal } from "@/lib/ledger/post";
import { dateOnly } from "@/lib/format";

const R = (currency: string, quote: string, y: number, m: number, d: number, kind: "SPOT" | "AVERAGE", rate: string): RateRow => ({ currency, quote, date: dateOnly(y, m, d), kind, rate });

describe("rate lookup rules", () => {
  const rows = [R("SGD", "IDR", 2024, 12, 31, "SPOT", "12050"), R("SGD", "IDR", 2024, 12, 31, "AVERAGE", "11800"), R("USD", "SGD", 2025, 3, 10, "SPOT", "1.34"), R("SGD", "IDR", 2025, 6, 30, "AVERAGE", "12100")];
  it("closing = SPOT in the same month, direct or inverse", () => {
    expect(closingRate(rows, "SGD", "IDR", dateOnly(2024, 12, 31))).toBe("12050");
    expect(closingRate(rows, "SGD", "IDR", dateOnly(2025, 1, 31))).toBeNull(); // stale — never reused silently
    expect(closingRate(rows, "SGD", "USD", dateOnly(2025, 3, 31))).toBe("0.7462686567");
    expect(lookupRate(rows, "SGD", "IDR", dateOnly(2025, 1, 31))).toBe("12050");
  });
  it("average = first AVERAGE on/after the period end within the year", () => {
    expect(averageRate(rows, "SGD", "IDR", dateOnly(2024, 3, 31))).toBe("11800");
    expect(averageRate(rows, "SGD", "IDR", dateOnly(2025, 2, 28))).toBe("12100");
    expect(averageRate(rows, "SGD", "IDR", dateOnly(2025, 9, 30))).toBeNull();
  });
  it("validates typed-in rates and formats them without floats", () => {
    expect(validateRateInput({ currency: "SGD", quote: "IDR", date: "2025-12-31", kind: "SPOT", rate: "12.250,50" })).toMatchObject({ rate: "12250.5" });
    expect(() => validateRateInput({ currency: "SGD", quote: "SGD", date: "2025-12-31", kind: "SPOT", rate: "1" })).toThrow(RateError);
    expect(() => validateRateInput({ currency: "SGD", quote: "IDR", date: "", kind: "SPOT", rate: "1" })).toThrow(/tanggal/);
    expect(() => validateRateInput({ currency: "SGD", quote: "IDR", date: "2025-12-31", kind: "SPOT", rate: "abc" })).toThrow(/angka positif/);
    expect(formatRateId("12250.5")).toBe("12.250,5");
    expect(formatRateId("1.31")).toBe("1,31");
    expect(normalizeRateInput("12.250")).toBe("12250");
    expect(normalizeRateInput("1,31")).toBe("1.31");
    expect(normalizeRateInput("1.31")).toBe("1.31");
    expect(normalizeRateInput("11,245.50")).toBe("11245.50");
  });
});

describe("rate table", () => {
  beforeEach(resetDb);

  it("file rates never overwrite an existing rate, whatever its source", async () => {
    const g = await makeGroup();
    const row = R("USD", "SGD", 2023, 1, 3, "SPOT", "1.30");
    await upsertRate(db, g.firm.id, { ...row, source: "MANUAL" });
    await upsertFileRate(db, g.firm.id, { ...row, rate: "1.31" });
    expect((await db.exchangeRate.findFirstOrThrow()).rate).toBe("1.3");
    await upsertFileRate(db, g.firm.id, { ...row, date: dateOnly(2023, 1, 4), rate: "1.31" });
    expect(await db.exchangeRate.count({ where: { source: "FILE" } })).toBe(1);
    await upsertFileRate(db, g.firm.id, { ...row, date: dateOnly(2023, 1, 4), rate: "1.3669" });
    expect((await db.exchangeRate.findFirstOrThrow({ where: { date: dateOnly(2023, 1, 4) } })).rate).toBe("1.31");
  });

  it("lists what the Gabungan needs for a non-IDR entity", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    const acc = async (code: string) => (await db.account.findUniqueOrThrow({ where: { clientId_code: { clientId: g.client.id, code } } })).id;
    const [kas, modal, beban] = [await acc("1110"), await acc("3100"), await acc("6190")];
    // 2023: capital only (no P&L → no average needed); 2024: an expense.
    await db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2023, 1, 3), kind: "ADJUSTMENT", memo: "x", lines: [{ accountId: kas, debit: 100n }, { accountId: modal, credit: 100n }] }));
    await db.$transaction((tx) => postJournal(tx, { entityId: g.pt.entity.id, date: dateOnly(2024, 5, 15), kind: "ADJUSTMENT", memo: "x", lines: [{ accountId: beban, debit: 10n }, { accountId: kas, credit: 10n }] }));
    await upsertRate(db, g.firm.id, R("SGD", "IDR", 2023, 12, 31, "SPOT", "11900"));
    const needs = await rateNeeds(db, g.client.id);
    expect(needs.map((n) => [n.label, n.kind, n.date.toISOString().slice(0, 10), n.present])).toEqual([
      ["Kurs historis PT Uji (entri pertama)", "SPOT", "2023-01-31", false],
      ["Kurs penutup 2023", "SPOT", "2023-12-31", true],
      ["Kurs penutup 2024", "SPOT", "2024-05-31", false],
      ["Kurs rata-rata 2024", "AVERAGE", "2024-05-31", false],
    ]);
  });

  it("posting a ledger saves the rates written in the file", async () => {
    const g = await makeGroup();
    await db.entity.update({ where: { id: g.pt.entity.id }, data: { functionalCurrency: "SGD" } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("GL");
    ws.addRow(["Entity", "Entry Date", "Account Code", "Account Name", "Currency", "Debit", "Credit", "Notes"]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2023, 0, 3)), "10001", "Bank USD", "USD", 150000, 0, "Ref: JAN23-02; Rate: 1.31"]);
    ws.addRow(["PT Uji", new Date(Date.UTC(2023, 0, 3)), "20000", "Loan Payable", "SGD", 0, 150000, ""]);
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "hc.xlsx", data: Buffer.from(await wb.xlsx.writeBuffer()) });
    if (st.status !== "STAGED") throw new Error("not staged");
    await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, st.importId);
    await acceptMappings(db, g.client.id, src.map((s) => ({ sourceAccountId: s.id, accountCode: s.suggestedCode!, method: s.suggestedBy! })));
    expect(await db.exchangeRate.count()).toBe(0); // not before posting
    await postImport(db, g.client.id, st.importId);
    const rate = await db.exchangeRate.findFirstOrThrow();
    expect([rate.currency, rate.quote, rate.rate, rate.source, rate.date.toISOString().slice(0, 10)]).toEqual(["USD", "SGD", "1.31", "FILE", "2023-01-03"]);
    expect(rate.note).toBe("hc.xlsx GL!2");
  });
});

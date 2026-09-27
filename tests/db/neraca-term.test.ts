import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { db, makeGroup, resetDb } from "../helpers";
import { importSourceAccounts, stageImport } from "@/lib/ledger-import/post";
import { suggestMappings } from "@/lib/ledger-import/mapping";
import { dateOnly } from "@/lib/format";

/** Jurnal (Mekari) Neraca export shape: title rows, "Date | | dd/mm/yyyy", then code | name | amount under headings. */
async function jurnalNeraca() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Balance Sheet");
  const rows: (string | number | null)[][] = [
    ["PT CONTOH"], ["Balance Sheet"], ["31/05/2026"], ["(in IDR)"],
    ["Date", null, "31/05/2026"],
    ["Assets"],
    ["Current Assets"],
    ["1-1000", "Bank", 900],
    ["Total Current Assets", null, 900],
    ["Other Assets"],
    ["1-1810", "Deposit", 100],
    ["Total Assets", null, 1000],
    ["Liability & Equity"],
    ["Current Liability"],
    ["2-2000", "Accounts Payable", 200],
    ["2-2100", "Loan from Bank", 100],
    ["Total Current Liability", null, 300],
    ["Long-term Liability"],
    ["2-2744", "Others Payables-Related Parties", 400],
    ["2-2783", "Employee Benefits Liabilities", 50],
    ["Total Long-term Liability", null, 450],
    ["Equity"],
    ["3-3000", "Share Capital", 250],
    ["Total Liability & Equity", null, 1000],
  ];
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("Neraca sub-headings steer mapping", () => {
  beforeEach(resetDb);

  it("keeps each account's current / long-term section and suggests the matching Buku account", async () => {
    const g = await makeGroup();
    const st = await stageImport(db, { firmId: g.firm.id, clientId: g.client.id, fileName: "neraca.xlsx", data: await jurnalNeraca(), entityId: g.pt.entity.id, date: dateOnly(2026, 5, 31) });
    if (st.status !== "STAGED") throw new Error("not staged");
    await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: null, useAi: false });
    const src = await importSourceAccounts(db, st.importId);
    const by = (name: string) => src.find((s) => s.name === name)!;

    expect([by("Bank").termHint, by("Deposit").termHint, by("Accounts Payable").termHint, by("Others Payables-Related Parties").termHint, by("Share Capital").termHint]).toEqual(["CURRENT", "NON_CURRENT", "CURRENT", "NON_CURRENT", null]);
    expect(by("Others Payables-Related Parties").suggestedCode).toBe("2300"); // generic "payable" (2120) is on the wrong side
    expect(by("Employee Benefits Liabilities").suggestedCode).toBe("2310"); // specific long-term keyword kept
    expect(by("Accounts Payable").suggestedCode).toBe("2110");
    expect(by("Loan from Bank").suggestedCode).toBe("2120"); // "loan" alone reads long-term; the file says current
    expect(by("Deposit").suggestedCode).toBe("1260"); // prepaid/deposit keyword is current; the file says non-current
    expect(by("Others Payables-Related Parties").mapReason).toMatch(/bagian liabilitas jangka panjang/);
  });
});

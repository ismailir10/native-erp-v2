import { describe, expect, it } from "vitest";
import { chronologicalOrder, dateParts, dayMonthEvidence } from "@/lib/import/parsers/common";
import { parseStatement } from "@/lib/import/parsers";
import { detectTables, readSheets, readTable } from "@/lib/ledger-import/read";
import { planLedger, type EntityInfo } from "@/lib/ledger-import/check";

// QA E17: a US-format file (month/day) was read day/month in silence. The order is decided once per file, never per row.
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("day/month evidence", () => {
  it("a first number > 12 proves day/month, a second one month/day", () => {
    expect(dayMonthEvidence(["01/02/2026", "13/02/2026"])).toMatchObject({ dmy: "13/02/2026", mdy: null });
    expect(dayMonthEvidence(["02/01/2026", "02/13/2026"])).toMatchObject({ dmy: null, mdy: "02/13/2026" });
    expect(dayMonthEvidence(["13/02/2026", "02/13/2026"])).toMatchObject({ dmy: "13/02/2026", mdy: "02/13/2026" });
    expect(dayMonthEvidence(["01/02/2026", "03/04/2026", "SALDO AWAL", "01 Agu 2026"])).toMatchObject({ dmy: null, mdy: null, numeric: ["01/02/2026", "03/04/2026"] });
  });

  it("with every number ≤ 12, the order that runs in time wins; day/month on a tie", () => {
    expect(chronologicalOrder(["01/03/2026", "05/03/2026", "09/03/2026"])).toBe("DMY");
    expect(chronologicalOrder(["03/01/2026", "03/05/2026", "04/02/2026"])).toBe("MDY"); // 1 and 5 March, 2 April written month first
    expect(chronologicalOrder(["03/01/2026", "03/05/2026", "03/09/2026"])).toBe("DMY"); // runs in time both ways: day/month
    expect(chronologicalOrder(["09/03/2026", "05/03/2026", "01/03/2026"])).toBe("DMY"); // newest first
    expect(chronologicalOrder(["05/05/2026", "05/05/2026"])).toBe("DMY");
    expect(chronologicalOrder(["01/03/2026", "02/01/2026", "01/02/2026"])).toBeNull();
  });

  it("dateParts reads two-number dates month first only when told", () => {
    expect(dateParts("02/13/2026")).toBeNull();
    expect(dateParts("02/13/2026", { order: "MDY" })).toEqual({ d: 13, m: 2, y: 2026 });
    expect(dateParts("2026-02-13", { order: "MDY" })).toEqual({ d: 13, m: 2, y: 2026 });
    expect(dateParts("13 Feb 2026", { order: "MDY" })).toEqual({ d: 13, m: 2, y: 2026 });
  });
});

describe("bank statement (generic CSV)", () => {
  const csv = (rows: string[]) => Buffer.from(["Tanggal,Keterangan,Debet,Kredit,Saldo", ...rows, ""].join("\n"));

  it("a US export is read month/day and says so", async () => {
    const st = await parseStatement("us.csv", csv(["02/03/2026,A,0,100,1100", "02/13/2026,B,50,0,1050", "02/27/2026,C,0,10,1060"]));
    expect(st.rows.map((r) => day(r.date))).toEqual(["2026-02-03", "2026-02-13", "2026-02-27"]);
    expect(st.notes?.join(" ")).toMatch(/bulan\/hari \(format AS\).*02\/13\/2026/);
  });

  it("an all-ambiguous file follows the order that runs in time", async () => {
    const st = await parseStatement("us.csv", csv(["03/01/2026,A,0,100,1100", "03/05/2026,B,50,0,1050", "04/02/2026,C,0,10,1060"]));
    expect(st.rows.map((r) => day(r.date))).toEqual(["2026-03-01", "2026-03-05", "2026-04-02"]);
    expect(st.notes?.join(" ")).toMatch(/hanya bulan\/hari yang urut waktunya/);
  });

  it("a file mixing both formats is refused, naming one of each", async () => {
    await expect(parseStatement("campur.csv", csv(["13/02/2026,A,0,100,1100", "02/14/2026,B,50,0,1050"]))).rejects.toThrow(/mencampur format hari\/bulan \("13\/02\/2026"\) dan bulan\/hari \("02\/14\/2026"\)/);
  });

  it("an Indonesian file is read as before, with no note", async () => {
    const st = await parseStatement("id.csv", csv(["01/08/2026,A,0,100,1100", "02/08/2026,B,50,0,1050", "15/08/2026,C,0,10,1060"]));
    expect(st.rows.map((r) => day(r.date))).toEqual(["2026-08-01", "2026-08-02", "2026-08-15"]);
    expect(st.notes?.join(" ") ?? "").not.toMatch(/bulan\/hari|tidak bisa dipastikan/);
  });

  it("an all-ambiguous file in no order is read day/month and says it can't be sure", async () => {
    const st = await parseStatement("acak.csv", csv(["01/03/2026,A,0,100,1100", "02/01/2026,B,50,0,1050", "01/02/2026,C,0,10,1060"]));
    expect(st.notes?.join(" ")).toMatch(/tidak bisa dipastikan/);
  });
});

describe("ledger file", () => {
  const ENT = new Map<string, EntityInfo>([["", { entityId: "e1", name: "PT Uji", currency: "IDR" }]]);
  const gl = async (dates: string[]) => {
    const lines = ["No. Bukti;Tanggal;Kode Akun;Nama Akun;Debit;Kredit;Keterangan"];
    dates.forEach((d, i) => lines.push(`JV-${i};${d};1110;Kas;100;0;x`, `JV-${i};${d};3100;Modal;0;100;x`));
    const sheets = await readSheets("gl.csv", Buffer.from(lines.join("\n") + "\n"));
    const read = readTable(sheets, detectTables(sheets)[0]);
    if (read.mode !== "LEDGER") throw new Error("expected a ledger");
    return { read, plan: planLedger(read.rows, { entities: ENT, currencyMode: "FUNCTIONAL", dateOrder: read.dateOrder }) };
  };

  it("a US ledger posts on the right dates with an INFO", async () => {
    const { read, plan } = await gl(["01/05/2026", "01/20/2026"]);
    expect(read.rows.map((r) => day(r.date!))).toContain("2026-01-20");
    expect(read.rows.map((r) => day(r.date!))).toContain("2026-01-05");
    expect(plan.checks.find((c) => c.code === "DATE_ORDER_US")?.severity).toBe("INFO");
    expect(plan.checks.filter((c) => c.severity === "BLOCK")).toEqual([]);
  });

  it("an all-ambiguous ledger stays day/month with an INFO", async () => {
    const { read, plan } = await gl(["01/05/2026", "02/05/2026"]);
    expect(read.rows.map((r) => day(r.date!))).toContain("2026-05-02");
    expect(plan.checks.find((c) => c.code === "DATE_ORDER_UNSURE")?.severity).toBe("INFO");
  });

  it("a ledger mixing both is blocked", async () => {
    const { plan } = await gl(["20/01/2026", "01/21/2026"]);
    expect(plan.checks.find((c) => c.code === "DATE_ORDER_MIXED")?.severity).toBe("BLOCK");
  });

  it("an Indonesian ledger has no date-order check", async () => {
    const { plan } = await gl(["05/01/2026", "20/01/2026"]);
    expect(plan.checks.filter((c) => c.code.startsWith("DATE_ORDER"))).toEqual([]);
  });
});

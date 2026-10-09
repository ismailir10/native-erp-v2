import { describe, expect, it } from "vitest";
import { parseStatement, parseStatementSections } from "@/lib/import/parsers";
import { isMt940 } from "@/lib/import/parsers/mt940";
import { checkContinuity } from "@/lib/import/normalize";
import { mt940 } from "../bank-layouts";

const file = (...lines: string[]) => Buffer.from(lines.join("\r\n"));

describe("MT940", () => {
  it("is recognised by its tags, never by the file name", async () => {
    expect(isMt940(mt940("CENAIDJA", "0000012345").toString())).toBe(true);
    expect(isMt940("Tanggal,Keterangan,Debet,Kredit,Saldo\n01/08/2026,:20: A,0,1,1")).toBe(false);
    const st = await parseStatement("rekening.csv", mt940("CENAIDJA", "0000012345"));
    expect(st.format).toBe("BCA");
  });

  it("joins daily statements of one account and prints each day's closing on its last row", async () => {
    const st = await parseStatement("m.sta", mt940("BMRIIDJA", "1370000123456", { daily: true }));
    expect(st.rows.map((r) => r.balance)).toEqual([155_500_000n, 153_050_000n, null, 138_095_678n, 138_080_678n]);
    expect(st.notes?.some((n) => n.includes("4 pernyataan MT940"))).toBe(true);
    expect(st.periodStart.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(st.periodEnd.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("shows a gap between days instead of hiding it", async () => {
    const st = await parseStatement(
      "gap.txt",
      file(":20:A", ":25:0000012345", ":60F:C260731IDR1000,00", ":61:2608010801C100,00NTRFNONREF", ":86:SETOR", ":62F:C260801IDR1100,00",
        ":20:B", ":25:0000012345", ":60F:C260801IDR1200,00", ":61:2608020802D50,00NTRFNONREF", ":86:TARIK", ":62F:C260802IDR1150,00"),
    );
    expect(checkContinuity(st).ok).toBe(false);
  });

  it("refuses an empty day whose balance doesn't continue the day before", async () => {
    await expect(
      parseStatement("gap.txt", file(":20:A", ":25:0000012345", ":60F:C260731IDR1000,00", ":61:2608010801C100,00NTRFNONREF", ":62F:C260801IDR1100,00", ":20:B", ":25:0000012345", ":60F:C260801IDR900,00", ":62F:C260802IDR900,00")),
    ).rejects.toThrow(/tidak nyambung/);
  });

  it("reads reversals the other way, funds codes, a multi-line :86: and a booking date across the year end", async () => {
    const st = await parseStatement(
      "x.mt940",
      file(
        ":20:STMT", ":25:CENAIDJA/0000012345", ":28C:00001/001", ":60F:C261230IDR1000000,00",
        ":61:2612311231CR250000,NTRFNONREF//FT1", ":86:TRSF E-BANKING CR", "PT MITRA UNGGAS FIKTIF", "INV 2026-12",
        ":61:2612310101D40000,00NMSCNONREF", ":86:BIAYA ADM",
        ":61:2612310101RC250000,00NTRFNONREF", ":86:KOREKSI TRSF",
        ":61:2612310101RD40000,00NMSCNONREF", ":86:KOREKSI BIAYA",
        ":62F:C270101IDR1000000,00",
      ),
    );
    expect(st.rows.map((r) => [r.date.toISOString().slice(0, 10), r.amount])).toEqual([
      ["2026-12-31", 250_000n],
      ["2027-01-01", -40_000n],
      ["2027-01-01", -250_000n],
      ["2027-01-01", 40_000n],
    ]);
    expect(st.rows[0].description).toBe("TRSF E-BANKING CR PT MITRA UNGGAS FIKTIF INV 2026-12");
    expect(st.accountNumber).toBe("0000012345");
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("lists several accounts as sections and keeps a foreign-currency account apart", async () => {
    const sections = await parseStatementSections(
      "multi.mt940",
      file(
        "{1:F01BMRIIDJAAXXX0000000000}{2:O9401200260901BMRIIDJAXXXX00000000002609011200N}{4:",
        ":20:A", ":25:1370000123456", ":60F:C260731IDR1000,00", ":61:2608010801C100,00NTRFNONREF", ":86:SETOR", ":62F:C260801IDR1100,00",
        "-}",
        ":20:B", ":25:1370000999999", ":60F:C260731USD500,00", ":61:2608010801D20,50NTRFNONREF", ":86:FEE", ":62F:C260801USD479,50",
        "-}",
      ),
    );
    expect(sections.map((s) => [s.format, s.accountNumber, s.section?.currency, s.rows.length])).toEqual([
      ["MANDIRI", "1370000123456", "IDR", 1],
      ["MANDIRI", "1370000999999", "USD", 1],
    ]);
  });

  it("reads a multi-message export where every statement carries its own SWIFT envelope and trailer", async () => {
    const env = "{1:F01CENAIDJAAXXX0000000000}{2:O9401200260901CENAIDJAXXXX00000000002609011200N}{3:{108:MT940}}{4:";
    const st = await parseStatement(
      "fin.txt",
      file(
        env, ":20:A", ":25:0000012345", ":28C:00001/001", ":60F:C260731IDR1000,00", ":61:2608010801C100,00NTRFNONREF", ":86:SETOR", ":62F:C260801IDR1100,00", "-}{5:{CHK:ABC123}}",
        env, ":20:B", ":25:0000012345", ":28C:00002/001", ":60F:C260801IDR1100,00", ":61:2608020802D50,00NTRFNONREF", ":86:TARIK", ":62F:C260802IDR1050,00", "-}",
      ),
    );
    expect(st.format).toBe("BCA");
    expect(st.rows.map((r) => [r.amount, r.balance])).toEqual([[100n, 1100n], [-50n, 1050n]]);
    expect(st.closingBalance).toBe(1050n);
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("names each account's bank from the BIC in front of its own number", async () => {
    const sections = await parseStatementSections(
      "forwarded.mt940",
      file(
        ":20:A", ":25:CENAIDJA/0000012345", ":60F:C260731IDR1000,00", ":61:2608010801C100,00NTRFNONREF", ":62F:C260801IDR1100,00",
        ":20:B", ":25:BMRIIDJA/1370000123456", ":60F:C260731IDR500,00", ":61:2608010801D50,00NTRFNONREF", ":62F:C260801IDR450,00",
      ),
    );
    expect(sections.map((s) => [s.accountNumber, s.format, s.section?.label])).toEqual([
      ["0000012345", "BCA", "BCA"],
      ["1370000123456", "MANDIRI", "Mandiri"],
    ]);
  });

  it("says what is wrong with a line it can't read", async () => {
    await expect(parseStatement("x.txt", file(":20:A", ":25:0000012345", ":60F:C260731IDR1000,00", ":61:26AB01C100,00NTRF"))).rejects.toThrow(/:61: di baris 4 tidak bisa dibaca/);
    await expect(parseStatement("x.txt", file(":20:A", ":25:0000012345", ":61:2608010801C100,00NTRFNONREF", ":60F:C260731IDR1000,00"))).rejects.toThrow(/sebelum saldo awal/);
  });
});

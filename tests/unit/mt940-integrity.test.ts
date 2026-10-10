import { describe, expect, it } from "vitest";
import { parseMt940 } from "@/lib/import/parsers/mt940";
import { ParseError } from "@/lib/import/types";
import { mt940 } from "../bank-layouts";

const statement = (options: { opening?: string; closing?: string; rows?: string[]; page?: string; openTag?: string; closeTag?: string } = {}) => [
  ":20:TEST", ":25:0000012345", `:28C:${options.page ?? "00001/001"}`,
  `:${options.openTag ?? "60F"}:${options.opening ?? "C260731IDR1000,00"}`,
  ...(options.rows ?? [":61:2608010801C100,00NTRFNONREF"]),
  ...(options.closing === "" ? [] : [`:${options.closeTag ?? "62F"}:${options.closing ?? "C260801IDR1100,00"}`]),
].join("\n");

describe("MT940 source integrity", () => {
  it("retains declared currency and printed provenance", () => {
    const [parsed] = parseMt940(statement());
    expect(parsed.currency).toBe("IDR");
    expect(parsed.provenance).toEqual({ period: "DECLARED", opening: "PRINTED", closing: "PRINTED" });
    expect(parsed.openingBalance).toBe(1000n);
    expect(parsed.closingBalance).toBe(1100n);
  });

  it("preserves complete daily intermediate-balance exports", () => {
    const [parsed] = parseMt940(mt940("BMRIIDJA", "1370000123456", { daily: true }).toString());
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.closingBalance).toBe(138080678n);
    expect(parsed.periodStart.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it.each([
    ["missing final closing", statement({ closing: "" }), /tidak memiliki saldo akhir/],
    ["contradictory closing", statement({ closing: "C260801IDR900,00" }), /tidak sesuai/],
    ["currency change", statement({ closing: "C260801USD1100,00" }), /Mata uang/],
    ["zero day", statement({ opening: "C260800IDR1000,00" }), /kalender/],
    ["February overflow", statement({ opening: "C260231IDR1000,00" }), /kalender/],
    ["invalid booking day", statement({ rows: [":61:2608010800C100,00NTRFNONREF"] }), /kalender/],
    ["reversed balance dates", statement({ opening: "C260802IDR1000,00" }), /mendahului/],
    ["booking outside period", statement({ rows: [":61:2608020802C100,00NTRFNONREF"] }), /di luar periode/],
    ["missing first page", statement({ openTag: "60M" }), /tidak lengkap/],
    ["missing last page", statement({ closeTag: "62M" }), /tidak lengkap/],
    ["invalid page", statement({ page: "1/0" }), /tidak valid/],
    ["first numbered page missing", statement({ page: "1/2" }), /tidak lengkap/],
    ["duplicate closing", `${statement()}\n:62F:C260801IDR1100,00`, /berulang/],
    ["late transaction", `${statement()}\n:61:2608010801C100,00NTRFNONREF`, /setelah saldo akhir/],
  ])("rejects %s", (_label, input, message) => {
    expect(() => parseMt940(input)).toThrow(ParseError);
    expect(() => parseMt940(input)).toThrow(message);
  });

  it("rejects a missing closing in an earlier block even when the aggregate adds up", () => {
    expect(() => parseMt940(`${statement({ closing: "" })}\n${statement({ opening: "C260801IDR1100,00", closing: "C260802IDR1200,00", page: "2/1" })}`)).toThrow(/tidak memiliki saldo akhir/);
  });

  it("rejects contradictory openings even when both blocks contain valid transactions", () => {
    const second = statement({ opening: "C260801IDR1200,00", closing: "C260802IDR1300,00", page: "2/1", rows: [":61:2608020802C100,00NTRFNONREF"] });
    expect(() => parseMt940(`${statement()}\n${second}`)).toThrow(/tidak nyambung/);
  });

  it.each(["1/1", "1/3", "3/1", "1/0"])("rejects a missing or repeated page %s", (page) => {
    const next = statement({ opening: "C260801IDR1100,00", closing: "C260802IDR1200,00", page, rows: [":61:2608020802C100,00NTRFNONREF"] });
    expect(() => parseMt940(`${statement()}\n${next}`)).toThrow(/halaman|valid/);
  });

  it("accepts consecutive pages and retains opening-day bookings", () => {
    const first = statement({ closeTag: "62M" });
    const second = statement({ openTag: "60M", opening: "C260801IDR1100,00", closing: "C260801IDR1200,00", page: "1/2" });
    const [parsed] = parseMt940(`${first}\n${second}`);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.periodStart.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("rejects missing date intervals even when adjacent balances agree", () => {
    const next = statement({ opening: "C260804IDR1100,00", closing: "C260805IDR1200,00", page: "2/1", rows: [":61:2608050805C100,00NTRFNONREF"] });
    expect(() => parseMt940(`${statement()}\n${next}`)).toThrow(/selang tanggal yang hilang/);
  });

  it("rejects an intermediate closing followed by a fresh opening", () => {
    const next = statement({ opening: "C260801IDR1100,00", closing: "C260802IDR1200,00", page: "2/1" });
    expect(() => parseMt940(`${statement({ closeTag: "62M" })}\n${next}`)).toThrow(/saldo antara/);
  });

  it("accepts a leap-day booking and year-end statement rollover", () => {
    expect(parseMt940(statement({ opening: "C240228IDR1000,00", closing: "C240229IDR1100,00", rows: [":61:2402290229C100,00NTRFNONREF"] }))[0].rows[0].date.toISOString()).toContain("2024-02-29");
    const previous = statement({ opening: "C261230IDR1000,00", closing: "C270101IDR1100,00", rows: [":61:2612310101C100,00NTRFNONREF"], page: "365/1" });
    const next = statement({ opening: "C270101IDR1100,00", closing: "C270102IDR1200,00", rows: [":61:2701020102C100,00NTRFNONREF"], page: "1/1" });
    expect(parseMt940(`${previous}\n${next}`)[0].closingBalance).toBe(1200n);
  });

  it("checks foreign sections using exact source decimals before IDR rounding", () => {
    const source = statement({ opening: "C260731USD500,00", rows: [":61:2608010801D20,50NTRFNONREF"], closing: "C260801USD479,50" });
    expect(parseMt940(source)[0].currency).toBe("USD");
    expect(() => parseMt940(source.replace("479,50", "479,49"))).toThrow(/tidak sesuai/);
  });

  it.each(["at EOF", "before another message"])("rejects a message without an opening %s", (position) => {
    const dangling = ":20:NEXT\n:25:0000012345\n:28C:2/1";
    const suffix = position === "at EOF" ? "" : `\n${statement()}`;
    expect(() => parseMt940(`${statement()}\n${dangling}${suffix}`)).toThrow(/terpotong.*saldo awal/);
  });

  it("allows general statement information after a complete closing", () => {
    const [parsed] = parseMt940(`${statement()}\n:86:INFORMASI UMUM REKENING`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.closingBalance).toBe(1100n);
  });

  it("checks source cents rather than accepting a discrepancy hidden by rounding", () => {
    expect(() => parseMt940(statement({ closing: "C260801IDR1100,01" }))).toThrow(/tidak sesuai/);
  });
});

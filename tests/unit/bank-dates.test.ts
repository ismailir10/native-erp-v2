import { describe, expect, it } from "vitest";
import { dateParts, excelSerialDate } from "@/lib/import/parsers/common";

describe("dateParts: the dates bank exports print", () => {
  it.each([
    ["01/08/2026", { d: 1, m: 8, y: 2026 }],
    ["1-8-26", { d: 1, m: 8, y: 2026 }],
    ["2026-08-31", { d: 31, m: 8, y: 2026 }],
    ["2026-08-31T10:15:30", { d: 31, m: 8, y: 2026 }],
    ["2026-08-31T00:00:00.000Z", { d: 31, m: 8, y: 2026 }],
    ["2026-08-31 10:15:30+07:00", { d: 31, m: 8, y: 2026 }],
    ["2026-08-31T10:15:30.123+0700", { d: 31, m: 8, y: 2026 }],
    ["'01/08", { d: 1, m: 8, y: null }],
    ["01/08/26 10:15:30", { d: 1, m: 8, y: 2026 }],
    ["01-Aug-26", { d: 1, m: 8, y: 2026 }],
    ["01-Aug-2026", { d: 1, m: 8, y: 2026 }],
    ["01 Agu 2026", { d: 1, m: 8, y: 2026 }],
    ["01 AGT 2026", { d: 1, m: 8, y: 2026 }],
    ["05-Okt-2026", { d: 5, m: 10, y: 2026 }],
    ["15 Des 26", { d: 15, m: 12, y: 2026 }],
    ["3 Mei 2026 14:02", { d: 3, m: 5, y: 2026 }],
    ["03/Mei/2026", { d: 3, m: 5, y: 2026 }],
    ["20 Sept 2026", { d: 20, m: 9, y: 2026 }],
    ["20 Nopember 2026", { d: 20, m: 11, y: 2026 }],
    ["31 Agustus 2026", { d: 31, m: 8, y: 2026 }],
    ["Aug 01, 2026", { d: 1, m: 8, y: 2026 }],
    ["01 Agu", { d: 1, m: 8, y: null }],
  ])("%s", (text, expected) => {
    expect(dateParts(text)).toEqual(expected);
  });

  it.each(["31/13/2026", "32-Aug-2026", "01-Foo-2026", "SALDO AWAL", "", "0/8/2026", "12345"])("rejects %j", (text) => {
    expect(dateParts(text)).toBeNull();
  });

  it("reads an Excel serial only when asked to", () => {
    expect(dateParts("46235")).toBeNull();
    expect(dateParts("46235", { serial: true })).toEqual({ d: 1, m: 8, y: 2026 });
    expect(dateParts("46235.5", { serial: true })).toEqual({ d: 1, m: 8, y: 2026 });
    expect(dateParts("123", { serial: true })).toBeNull();
    expect(excelSerialDate(46236)?.toISOString().slice(0, 10)).toBe("2026-08-02");
  });
});

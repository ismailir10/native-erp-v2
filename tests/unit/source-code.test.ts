import { describe, expect, it } from "vitest";
import { displaySourceCode, sourceAccountLabel } from "@/lib/ledger-import/code";

describe("source account labels", () => {
  it("never shows the internal NC: key of a file without a code column", () => {
    expect(displaySourceCode("NC:Current Period Earnings")).toBe("");
    expect(sourceAccountLabel({ code: "NC:Current Period Earnings", name: "Current Period Earnings" })).toBe("Current Period Earnings");
    expect(sourceAccountLabel({ code: "63005", name: "Beban Sewa" })).toBe("63005 Beban Sewa");
  });
});

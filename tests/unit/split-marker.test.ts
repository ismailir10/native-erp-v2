import { expect, it } from "vitest";
import { splitMarker } from "@/lib/import/parsers/common";
it("splits the direction a bank prints after an amount off the number", () => {
  expect(splitMarker("1,000.00CR")).toEqual({ text: "1,000.00", flag: "CR" });
  expect(splitMarker("1.000,00 Db.")).toEqual({ text: "1.000,00", flag: "DB" });
  expect(splitMarker("1.000-")).toEqual({ text: "1.000", flag: "DB" });
  expect(splitMarker("-1.000")).toEqual({ text: "-1.000", flag: null });
  expect(splitMarker("1.000")).toEqual({ text: "1.000", flag: null });
  expect(splitMarker("ABC")).toEqual({ text: "ABC", flag: null });
  expect(splitMarker("(1.000)")).toEqual({ text: "(1.000)", flag: null });
});

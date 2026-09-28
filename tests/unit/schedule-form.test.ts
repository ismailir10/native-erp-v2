import { describe, expect, it } from "vitest";
import { sourceForKind } from "@/lib/adjust/form";

describe("schedule form source entry", () => {
  it("keeps a candidate's source while its kind is the candidate's, also after switching away and back", () => {
    const origin = { kind: "AMORTIZATION" as const, sourceEntryId: "entry-1" };
    expect(sourceForKind(origin, "DEPRECIATION")).toBeNull(); // a prepayment turned into a depreciation cites no candidate
    expect(sourceForKind(origin, "AMORTIZATION")).toBe("entry-1"); // back to the candidate's kind: the source returns
    expect(sourceForKind(null, "DEPRECIATION")).toBeNull(); // a blank form never has one
  });
});

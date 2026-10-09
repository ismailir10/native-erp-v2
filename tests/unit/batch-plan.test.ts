import { describe, expect, it } from "vitest";
import { planBatch } from "@/lib/import/batch-plan";

const f = (name: string, bankAccountId: string | null, periodStart: string | null) => ({ name, bankAccountId, periodStart });

describe("planBatch", () => {
  it("orders by account, then oldest period first, and puts what has no account or period last in the order it came", () => {
    const items = [f("bca-mar", "A", "2026-03-01"), f("sandi", null, null), f("mdr-jan", "B", "2026-01-01"), f("bca-jan", "A", "2026-01-01"), f("bca-feb", "A", "2026-02-01"), f("nomor", "B", null)];
    expect(planBatch(items, ["A", "B"]).map((x) => x.name)).toEqual(["bca-jan", "bca-feb", "bca-mar", "mdr-jan", "sandi", "nomor"]);
  });

  it("keeps the given order for the same account and period, and does not touch its input", () => {
    const items = [f("x", "A", "2026-01-01"), f("y", "A", "2026-01-01")];
    expect(planBatch(items, ["A"]).map((x) => x.name)).toEqual(["x", "y"]);
    expect(items.map((x) => x.name)).toEqual(["x", "y"]);
  });

  it("puts an account unknown to the order after the known ones' files, without throwing", () => {
    expect(planBatch([f("z", "Z", "2026-01-01"), f("a", "A", "2026-02-01")], ["A"]).map((x) => x.name)).toEqual(["a", "z"]);
  });
});

import { describe, expect, it } from "vitest";
import { BANKS } from "@/lib/banks";
import { LAYOUTS } from "../bank-layouts";

/** What the UI and the decks may claim: a bank's format counts only when a fixture of it reads (tests/unit/bank-layouts.test.ts). */
describe("bank coverage", () => {
  it("has a layout fixture for every format a bank lists", () => {
    const missing = BANKS.flatMap((b) => b.formats.filter((f) => !LAYOUTS.some((l) => l.bank === b.code && l.format === f.label)).map((f) => `${b.code} · ${f.label}`));
    expect(missing).toEqual([]);
  });

  it("lists every layout fixture as a format of its bank (no claim without a registry entry, no stale fixture)", () => {
    const orphans = LAYOUTS.filter((l) => !BANKS.find((b) => b.code === l.bank)?.formats.some((f) => f.label === l.format)).map((l) => `${l.bank} · ${l.format}`);
    expect(orphans).toEqual([]);
  });

  it("gives every one of the 25 banks at least one format, and says which rest on inference", () => {
    expect(BANKS.filter((b) => !b.formats.length)).toEqual([]);
    const inferredOnly = BANKS.filter((b) => b.formats.every((f) => f.evidence === "INFERRED")).map((b) => b.code);
    expect(inferredOnly.sort()).toEqual(["BJB", "DANAMON", "DKI", "MEGA", "PANIN", "SINARMAS"]);
  });
});

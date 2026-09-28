import { describe, expect, it } from "vitest";
import { originOf, sourceFor } from "@/lib/adjust/form";

const prepaid = originOf({ kind: "AMORTIZATION", entityId: "pt", sourceEntryId: "entry-1", key: "AMORTIZATION:pt:entry-1:1170" });
const asset = originOf({ kind: "DEPRECIATION", entityId: "pt", sourceEntryId: "entry-2", key: "DEPRECIATION:pt:entry-2:1210" });
const form = { kind: "AMORTIZATION" as const, entityId: "pt", memo: "Amortisasi Sewa", debitCode: "6120", creditCode: "1170" };

describe("schedule form source entry", () => {
  it("cites the candidate's entry only while the schedule still identifies its line", () => {
    expect(sourceFor(prepaid, form)).toBe("entry-1");
    expect(sourceFor(prepaid, { ...form, kind: "DEPRECIATION" })).toBeNull(); // another kind: no candidate
    expect(sourceFor(prepaid, { ...form, entityId: "cv" })).toBeNull(); // another entity, also after switching kinds back
    expect(sourceFor(prepaid, { ...form, creditCode: "1171" })).toBeNull(); // the amortised account edited away
    expect(sourceFor(prepaid, { ...form, creditCode: "1170" })).toBe("entry-1"); // and back
    const dep = { kind: "DEPRECIATION" as const, entityId: "pt", memo: "Penyusutan 1210 Aset Tetap 19 Agu 2026", debitCode: "6180", creditCode: "1219" };
    expect(sourceFor(asset, dep)).toBe("entry-2");
    expect(sourceFor(asset, { ...dep, memo: "Penyusutan mesin" })).toBeNull(); // the memo no longer names the asset
    expect(sourceFor(null, dep)).toBeNull(); // a blank form never cites one
  });
});

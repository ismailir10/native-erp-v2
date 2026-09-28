import { describe, expect, it } from "vitest";
import { originOf, sourceFor } from "@/lib/adjust/form";

const prepaid = originOf({ kind: "AMORTIZATION", entityId: "pt", sourceEntryId: "entry-1", key: "AMORTIZATION:pt:entry-1:1170", debitCode: null, creditCode: "1170" });
const deferred = originOf({ kind: "AMORTIZATION", entityId: "pt", sourceEntryId: "entry-3", key: "AMORTIZATION:pt:entry-3:2160", debitCode: "2160", creditCode: "4110" });
const asset = originOf({ kind: "DEPRECIATION", entityId: "pt", sourceEntryId: "entry-2", key: "DEPRECIATION:pt:entry-2:1210", debitCode: "6180", creditCode: "1219" });
const form = { kind: "AMORTIZATION" as const, entityId: "pt", memo: "Amortisasi Sewa", debitCode: "6120", creditCode: "1170" };

describe("schedule form source entry", () => {
  it("cites the candidate's entry only while the schedule still identifies its line", () => {
    expect(sourceFor(prepaid, form)).toBe("entry-1");
    expect(sourceFor(prepaid, { ...form, kind: "DEPRECIATION" })).toBeNull(); // another kind: no candidate
    expect(sourceFor(prepaid, { ...form, entityId: "cv" })).toBeNull(); // another entity, also after switching kinds back
    expect(sourceFor(prepaid, { ...form, creditCode: "1171" })).toBeNull(); // the amortised account edited away
    expect(sourceFor(prepaid, { ...form, creditCode: "1170" })).toBe("entry-1"); // and back
    expect(sourceFor(prepaid, { ...form, debitCode: "1170", creditCode: "2110" })).toBeNull(); // on the debit side it grows the prepayment
    const revenue = { kind: "AMORTIZATION" as const, entityId: "pt", memo: "Pengakuan", debitCode: "2160", creditCode: "4110" };
    expect(sourceFor(deferred, revenue)).toBe("entry-3");
    expect(sourceFor(deferred, { ...revenue, debitCode: "6120", creditCode: "2160" })).toBeNull(); // credited, it grows the deferral
    const dep = { kind: "DEPRECIATION" as const, entityId: "pt", memo: "Penyusutan 1210 Aset Tetap 19 Agu 2026", debitCode: "6180", creditCode: "1219" };
    expect(sourceFor(asset, dep)).toBe("entry-2");
    expect(sourceFor(asset, { ...dep, memo: "Penyusutan mesin" })).toBeNull(); // the memo no longer names the asset
    expect(sourceFor(null, dep)).toBeNull(); // a blank form never cites one
  });
});

import { describe, expect, it } from "vitest";
import { originOf, sourceFor as source } from "@/lib/adjust/form";

const accounts = [
  { code: "1170", type: "ASET" as const, fsLine: "BIAYA_DIBAYAR_DIMUKA" },
  { code: "1210", type: "ASET" as const, fsLine: "ASET_TETAP" },
  { code: "1219", type: "ASET" as const, fsLine: "AKUM_PENYUSUTAN" },
  { code: "2110", type: "LIABILITAS" as const, fsLine: "UTANG_USAHA" },
  { code: "6120", type: "BEBAN" as const, fsLine: "BEBAN_UMUM_ADM" },
  { code: "6180", type: "BEBAN" as const, fsLine: "BEBAN_UMUM_ADM" },
];
const sourceFor = (o: Parameters<typeof source>[0], f: Parameters<typeof source>[1]) => source(o, f, accounts);

const prepaid = originOf({ kind: "AMORTIZATION", entityId: "pt", sourceEntryId: "entry-1", key: "AMORTIZATION:pt:entry-1:1170", debitCode: null, creditCode: "1170" });
const deferred = originOf({ kind: "AMORTIZATION", entityId: "pt", sourceEntryId: "entry-3", key: "AMORTIZATION:pt:entry-3:2160", debitCode: "2160", creditCode: "4110" });
const asset = originOf({ kind: "DEPRECIATION", entityId: "pt", sourceEntryId: "entry-2", key: "DEPRECIATION:pt:entry-2:1210", debitCode: "6180", creditCode: "1219" });
const form = { kind: "AMORTIZATION" as const, entityId: "pt", debitCode: "6120", creditCode: "1170" };

const src = (sourceEntryId: string, sourceAccountCode: string) => ({ sourceEntryId, sourceAccountCode });

describe("schedule form source line", () => {
  it("records the candidate's entry and line only while the schedule still releases that line", () => {
    expect(sourceFor(prepaid, form)).toEqual(src("entry-1", "1170"));
    expect(sourceFor(prepaid, { ...form, kind: "DEPRECIATION" })).toBeNull(); // another kind: no candidate
    expect(sourceFor(prepaid, { ...form, entityId: "cv" })).toBeNull(); // another entity, also after switching kinds back
    expect(sourceFor(prepaid, { ...form, creditCode: "1171" })).toBeNull(); // the amortised account edited away
    expect(sourceFor(prepaid, { ...form, creditCode: "1170" })).toEqual(src("entry-1", "1170")); // and back
    expect(sourceFor(prepaid, { ...form, debitCode: "1170", creditCode: "2110" })).toBeNull(); // on the debit side it grows the prepayment
    const revenue = { kind: "AMORTIZATION" as const, entityId: "pt", debitCode: "2160", creditCode: "4110" };
    expect(sourceFor(deferred, revenue)).toEqual(src("entry-3", "2160"));
    expect(sourceFor(deferred, { ...revenue, debitCode: "6120", creditCode: "2160" })).toBeNull(); // credited, it grows the deferral
    // A depreciation keeps its asset line whatever its memo: the line is stored, not read back from the memo.
    const dep = { kind: "DEPRECIATION" as const, entityId: "pt", debitCode: "6180", creditCode: "1219" };
    expect(sourceFor(asset, dep)).toEqual(src("entry-2", "1210"));
    expect(sourceFor(asset, { ...dep, creditCode: "1210" })).toEqual(src("entry-2", "1210")); // written down directly
    expect(sourceFor(asset, { ...dep, debitCode: "6120", creditCode: "2110" })).toBeNull(); // rent to payables depreciates nothing
    expect(sourceFor(asset, { ...dep, debitCode: "1170" })).toBeNull(); // no expense on the debit side
    expect(sourceFor(null, dep)).toBeNull(); // a blank form never cites one
  });
});

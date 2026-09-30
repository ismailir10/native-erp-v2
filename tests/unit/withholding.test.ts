import { describe, expect, it } from "vitest";
import { classificationNets } from "@/lib/ledger/bank";
import { withholdingAccountCode, withholdingFor } from "@/lib/tax/withholding";

describe("withholding", () => {
  it("computes the tax on a base from a percentage, half up", () => {
    expect(withholdingFor(10_000_000n, "2")).toBe(200_000n);
    expect(withholdingFor(50_000_000n, "10")).toBe(5_000_000n);
    expect(withholdingFor(1_000_001n, "1,5")).toBe(15_000n); // 15.000,015 → 15.000
    expect(withholdingFor(333n, "2")).toBe(7n); // 6,66 → 7
    expect(() => withholdingFor(1n, "abc")).toThrow(/Tarif/);
    expect(() => withholdingFor(1n, "101")).toThrow(/Tarif/);
  });

  it("names the account of each kind: our credit on receipts, our liability on payments", () => {
    expect(withholdingAccountCode("PPH_23", "IN")).toBe("1180");
    expect(withholdingAccountCode("PPH_22", "IN")).toBe("1180");
    expect(withholdingAccountCode("PPH_4_2", "IN")).toBe("8200"); // final: not a credit
    expect(withholdingAccountCode("PPH_21", "OUT")).toBe("2140");
    expect(withholdingAccountCode("PPH_23", "OUT")).toBe("2141");
    expect(withholdingAccountCode("PPH_4_2", "OUT")).toBe("2145");
  });

  it("splits the classification side of a bank line by the withheld part; the bank side never moves", () => {
    // receipt 10.900.000 with 200.000 withheld: Dr 1180 200.000 / Cr receivable 11.100.000
    expect([...classificationNets(10_900_000n, { accountCode: "1130", withholding: { kind: "PPH_23", amount: 200_000n } })]).toEqual([["1130", -11_100_000n], ["1180", 200_000n]]);
    // rent paid 45.000.000 with 5.000.000 withheld: Dr rent 50.000.000 / Cr 2145 5.000.000
    expect([...classificationNets(-45_000_000n, { accountCode: "6120", withholding: { kind: "PPH_4_2", amount: 5_000_000n } })]).toEqual([["6120", 50_000_000n], ["2145", -5_000_000n]]);
    // no withholding: as before
    expect([...classificationNets(-45_000_000n, { accountCode: "6120" })]).toEqual([["6120", 45_000_000n]]);
    // the PPN split works on the gross (net + withheld)
    const nets = classificationNets(-11_100_000n + 200_000n, { accountCode: "6170", taxTag: "PPN_MASUKAN", withholding: { kind: "PPH_23", amount: 200_000n } });
    expect([...nets.values()].reduce((t, v) => t + v, 0n)).toBe(10_900_000n);
    expect(nets.get("2141")).toBe(-200_000n);
  });
});

import { describe, expect, it } from "vitest";
import { parseStatementSections } from "@/lib/import/parsers";
import { checkContinuity } from "@/lib/import/normalize";
import { makePdf, smbcCombinedPdf, table } from "@/tests/pdf-fixture";

/** UC-B1 cases in PDF statements (review probes d2, d3, g1, g1b, g2): sub-products merged, counterparty names lost. */
describe("PDF statements, UC-B1", () => {
  it("(d) refuses a second Saldo Awal that doesn't continue the balance, instead of merging two accounts; the shipped SMBC layout still splits", async () => {
    const header: [number, string][] = [[37, "Tanggal Transaksi"], [119, "Tanggal Pembukuan"], [246, "Keterangan"], [353, "Mutasi Debet"], [437, "Mutasi Kredit"], [531, "Saldo"]];
    const twoLineTitle = makePdf([[
      ...table(800, [[[32, "PT Bank SMBC Indonesia Tbk"], [318, "Periode Laporan"], [398, ": 01 MEI 2026 - 31 MEI 2026"]]]),
      ...table(740, [
        [[25, "Aktivitas Rekening / Account Activities"]],
        [[25, "Jenius Main Account (IDR) 90022152088"]],
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "5,646,633.00"]],
        [[45, "18-05-2026"], [132, "18-05-2026"], [199, "Cr BI fast Incoming"], [436, "250,000,000.00"], [523, "255,646,633.00"]],
      ]),
      ...table(600, [
        [[25, "Aktivitas Rekening / Account Activities"]],
        [[25, "GIRO KARYA (IDR) 05243002331"]],
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "649,569.00"]],
        [[45, "26-05-2026"], [132, "26-05-2026"], [199, "Bunga - Interest"], [445, "14,794,521.00"], [526, "15,444,090.00"]],
      ]),
    ]]);
    const noTitle = makePdf([[
      ...table(800, [[[32, "PT Bank SMBC Indonesia Tbk"], [318, "Periode Laporan"], [398, ": 01 MEI 2026 - 31 MEI 2026"]], [[32, "No. Rekening : 90022152088"]]]),
      ...table(740, [
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "5,646,633.00"]],
        [[45, "18-05-2026"], [132, "18-05-2026"], [199, "Cr BI fast Incoming"], [436, "250,000,000.00"], [523, "255,646,633.00"]],
        [[45, "Total"], [235, "1 DEBIT 1 KREDIT"], [436, "250,000,000.00"]],
        [[25, "GIRO KARYA 05243002331"]],
        header,
        [[45, "01-05-2026"], [132, "01-05-2026"], [199, "Saldo Awal - Beginning Balance"], [531, "649,569.00"]],
        [[45, "26-05-2026"], [132, "26-05-2026"], [199, "Bunga - Interest"], [445, "14,794,521.00"], [526, "15,444,090.00"]],
      ]),
    ]]);
    await expect(parseStatementSections("smbc.pdf", twoLineTitle)).rejects.toThrow(/lebih dari satu rekening: ada baris Saldo Awal kedua di halaman 1/);
    await expect(parseStatementSections("smbc.pdf", noTitle)).rejects.toThrow(/lebih dari satu rekening/);
    expect((await parseStatementSections("smbc.pdf", smbcCombinedPdf())).length).toBeGreaterThan(1);
  });

  it("(g) keeps the BCA counterparty after a TANGGAL line and across a page break", async () => {
    const head = [[40, "PT BANK CENTRAL ASIA TBK"], [40, "NO. REKENING : 8720145566"], [40, "PERIODE : AGUSTUS 2026"]] as [number, string][];
    const cols: [number, string][] = [[40, "TANGGAL"], [100, "KETERANGAN"], [330, "CBG"], [410, "MUTASI"], [510, "SALDO"]];
    const g1 = makePdf([[
      ...table(800, head.map((h) => [h])),
      ...table(720, [
        cols,
        [[40, "01/08"], [100, "SALDO AWAL"], [490, "10,000.00"]],
        [[40, "06/08"], [100, "TRSF E-BANKING CR 0608/FTSCY/WS930729"], [400, "1,000.00"], [462, "CR"], [490, "11,000.00"]],
        [[40, "TANGGAL :06/08"]],
        [[100, "PT MITRA UNGGAS SENTOSA"]],
        [[40, "07/08"], [100, "BIAYA ADM"], [402, "30.00"], [462, "DB"], [490, "10,970.00"]],
      ]),
    ]]);
    const g1b = makePdf([[
      ...table(800, head.map((h) => [h])),
      ...table(720, [
        cols,
        [[40, "01/08"], [100, "SALDO AWAL"], [490, "10,000.00"]],
        [[40, "06/08"], [100, "TRSF E-BANKING CR 0608/FTSCY/WS930729"], [400, "1,000.00"], [462, "CR"], [490, "11,000.00"]],
        [[100, "TANGGAL :06/08"]],
        [[100, "PT MITRA UNGGAS SENTOSA"]],
        [[40, "07/08"], [100, "BIAYA ADM"], [402, "30.00"], [462, "DB"], [490, "10,970.00"]],
      ]),
    ]]);
    const g2 = makePdf([
      [
        ...table(800, head.map((h) => [h])),
        ...table(720, [
          cols,
          [[40, "01/08"], [100, "SALDO AWAL"], [490, "10,000.00"]],
          [[40, "06/08"], [100, "TRSF E-BANKING CR 0608/FTSCY/WS930729"], [400, "1,000.00"], [462, "CR"], [490, "11,000.00"]],
        ]),
        { x: 40, y: 60, text: "Bersambung ke halaman berikut" },
      ],
      [
        ...table(800, head.map((h) => [h])),
        ...table(720, [
          cols,
          [[100, "PT MITRA UNGGAS SENTOSA"]],
          [[40, "07/08"], [100, "BIAYA ADM"], [402, "30.00"], [462, "DB"], [490, "10,970.00"]],
        ]),
      ],
    ]);
    for (const [name, pdf] of [["g1", g1], ["g1b", g1b], ["g2", g2]] as const) {
      const [st] = await parseStatementSections("bca.pdf", pdf);
      const trsf = st.rows.find((r) => r.description.startsWith("TRSF E-BANKING"))!;
      expect([name, trsf.description]).toEqual([name, "TRSF E-BANKING CR 0608/FTSCY/WS930729 PT MITRA UNGGAS SENTOSA"]);
      expect(st.rows.map((r) => r.amount)).toEqual([1000n, -30n]);
      expect(checkContinuity(st).ok).toBe(true);
    }
  });
});

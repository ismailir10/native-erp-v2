import { describe, expect, it } from "vitest";
import { parseStatement } from "@/lib/import/parsers";
import { checkContinuity, isGenericKey, merchantKey } from "@/lib/import/normalize";
import { matchRule, sortRules, FIRM_RULES } from "@/lib/classify/rules";
import { taxPaymentSuggestion } from "@/lib/classify/financing";
import { matchTransfers } from "@/lib/classify/transfer";

const BCA = `Informasi Rekening - Mutasi Rekening
No. rekening : 1111111111
Nama : PT UJI SEJAHTERA
Periode : 01/08/2026 - 31/08/2026
Kode Mata Uang : IDR

Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo
'01/08,"TRSF E-BANKING DB 0108/FTSCY/WS95051 PT PAKAN JAYA",'0000,"11,100,000.00",DB,"88,900,000.00"
'03/08,"TRSF E-BANKING CR 0308/FTSCY/WS95221 PT MITRA UNGGAS",'0000,"55,500,000.00",CR,"144,400,000.00"
PEND,"BIAYA ADM",'0000,"15,000.00",DB,"144,385,000.00"
"Saldo Awal : 100,000,000.00"
"Mutasi Kredit : 55,500,000.00"
"Mutasi Debet : 11,115,000.00"
"Saldo Akhir : 144,385,000.00"
`;

const BRI = `NOREK;3333333333
TGL_TRAN;DESK_TRAN;MUTASI_DEBET;MUTASI_KREDIT;SALDO_AKHIR_MUTASI
2026-08-02;TRANSFER DARI PT UJI SEJAHTERA;0.00;5000000.00;15000000.00
2026-08-05;INDOMARET BELANJA;250000.00;0.00;14750000.00
`;

describe("parsers", () => {
  it("parses BCA CSV with year-less dates, PEND and trailer", async () => {
    const st = await parseStatement("bca.csv", Buffer.from(BCA));
    expect(st.format).toBe("BCA");
    expect(st.accountNumber).toBe("1111111111");
    expect(st.openingBalance).toBe(100_000_000n);
    expect(st.closingBalance).toBe(144_385_000n);
    expect(st.rows.map((r) => r.amount)).toEqual([-11_100_000n, 55_500_000n, -15_000n]);
    expect(st.rows[2].date.toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(checkContinuity(st).ok).toBe(true);
  });

  it("parses BRI semicolon CSV and derives opening balance", async () => {
    const st = await parseStatement("bri.csv", Buffer.from(BRI));
    expect(st.format).toBe("BRI");
    expect(st.openingBalance).toBe(10_000_000n);
    expect(st.rows[1].amount).toBe(-250_000n);
  });

  it("detects a missing row via running balance", async () => {
    const broken = BCA.replace(/^'03\/08.*\n/m, "");
    const st = await parseStatement("bca.csv", Buffer.from(broken));
    const c = checkContinuity(st);
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/tidak nyambung/);
  });
});

describe("merchantKey", () => {
  it("strips channel noise, refs and amounts", () => {
    expect(merchantKey("TRSF E-BANKING DB 0108/FTSCY/WS95051 11100000.00 PT PAKAN JAYA")).toBe("PT PAKAN JAYA");
    expect(merchantKey("BI-FAST CR TRANSFER DARI CV SUMBER VAKSIN 20260801ABC123")).toBe("CV SUMBER VAKSIN");
    expect(merchantKey("BI FAST CR TRANSFER DARI CV SUMBER VAKSIN")).toBe("CV SUMBER VAKSIN"); // SMBC/Jenius spell it with a space
  });

  it("knows a key that names no counterparty", () => {
    for (const d of ["Db BI Fast Outgoing - BI Fast Outgoing", "Cr BI fast Incoming - BI Fast Incoming", "Pinjaman - Loan", "TRSF E-BANKING DB 0108/FTSCY/WS95051 15000000.00", "DEP0524DEP004097", "SETORAN TUNAI", "TARIKAN ATM 12/08"]) {
      expect([d, isGenericKey(merchantKey(d))]).toEqual([d, true]);
    }
    for (const d of ["BI-FAST DB BIF TRANSFER KE 002 ALFI YANDRA KBB", "TRSF E-BANKING CR 0706/FTSCY/WS95271 70475000.00 bayar nota barang sale Belifi DINA PUSPITA", "BIAYA ADM 0998", "BIAYA - Fee Payment", "Bunga - Interest", "Bea Materai - Stamp Duty", "PT PAKAN JAYA"]) {
      expect([d, isGenericKey(merchantKey(d))]).toEqual([d, false]);
    }
  });
});

describe("rules", () => {
  it("client rules win over firm rules; direction respected", () => {
    const rules = sortRules([
      ...FIRM_RULES.map((r) => ({ ...r, clientId: null })),
      { pattern: "BIAYA ADM", direction: "OUT" as const, accountCode: "6190", taxTag: null, priority: 99, clientId: "c1" },
    ]);
    expect(matchRule(rules, "BIAYA ADM BULAN AGUSTUS", "OUT")?.accountCode).toBe("6190");
    expect(matchRule(rules, "PAJAK BUNGA", "OUT")?.taxTag).toBe("PPH_4_2");
  });

  it("files bank interest, fees and stamp duty as printed by SMBC and BCA (real e-statements, 2026)", () => {
    const rules = sortRules(FIRM_RULES.map((r) => ({ ...r, clientId: null })));
    const code = (text: string, dir: "IN" | "OUT") => {
      const m = matchRule(rules, text, dir);
      return m && [m.accountCode, m.taxTag];
    };
    expect(code("Bunga - Interest", "OUT")).toEqual(["7110", null]); // PRK / loan interest
    expect(code("Bunga - Interest DEP0524DEP004097", "IN")).toEqual(["4900", null]);
    expect(code("Pajak Bunga - Tax on Interest DEP0524DEP004097", "OUT")).toEqual(["8200", "PPH_4_2"]);
    expect(code("BIAYA - Fee Payment", "OUT")).toEqual(["7100", null]);
    expect(code("Bea Materai - Stamp Duty", "OUT")).toEqual(["7100", null]);
    expect(code("BI-FAST DB BIF BIAYA TXN KE 002 ALFI YANDRA KBB", "OUT")).toEqual(["7100", null]);
    expect(code("Db BI Fast Outgoing - BI Fast Outgoing", "OUT")).toBeNull();
  });
});

describe("tax payment rules", () => {
  const rules = sortRules(FIRM_RULES.map((r) => ({ ...r, clientId: null })));
  const code = (text: string, dir: "IN" | "OUT" = "OUT", codes?: Set<string>) => {
    const m = matchRule(rules, text, dir, codes);
    return m && [m.accountCode, m.taxTag];
  };

  it("files a remittance to the liability it clears, not to an expense", () => {
    expect(code("SETORAN PAJAK PPH 21 DJP")).toEqual(["2140", "PPH_21"]);
    expect(code("TRSF E-BANKING DB PPH21 MASA DES")).toEqual(["2140", "PPH_21"]);
    expect(code("SETORAN PPH 23 JASA")).toEqual(["2141", "PPH_23"]);
    expect(code("BAYAR PPH 4(2) SEWA GEDUNG")).toEqual(["2145", "PPH_4_2"]);
    expect(code("SETOR PPH 4 AYAT 2 SEWA")).toEqual(["2145", "PPH_4_2"]);
    expect(code("PEMBAYARAN PPH FINAL UMKM")).toEqual(["2145", "PPH_4_2"]);
    expect(code("PEMBAYARAN PPH 29 TAHUN 2025")).toEqual(["2146", null]);
    expect(code("SETORAN PPN MASA JUL")).toEqual(["2130", "PPN_KELUARAN"]);
    expect(code("SETOR PPN AGUSTUS")).toEqual(["2130", "PPN_KELUARAN"]);
  });

  it("keeps PPh 25 a prepayment and the tax on interest final", () => {
    expect(code("SETORAN PPH 25 ANGSURAN")).toEqual(["1180", "PPH_25"]);
    expect(code("Pajak Bunga - Tax on Interest")).toEqual(["8200", "PPH_4_2"]);
    expect(code("SETORAN PPH 21", "IN")).toBeNull(); // only money out is a remittance
  });

  it("files Bea Meterai (the correct spelling) with the bank charges", () => {
    expect(code("Bea Meterai - Stamp Duty")).toEqual(["7100", null]);
    expect(code("BEA METERAI 10000")).toEqual(["7100", null]);
  });

  it("skips a rule whose account the client's chart lacks", () => {
    const chart = new Set(["2140", "1180", "7100"]);
    expect(code("SETORAN PPH 23 JASA", "OUT", chart)).toBeNull();
    expect(code("SETORAN PPH 21", "OUT", chart)).toEqual(["2140", "PPH_21"]);
  });
});

describe("transfer matcher", () => {
  const base = { merchantKey: "", direction: "OUT" as const };
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("pairs same-entity → 1199 and cross-entity → 1190, ignores unhinted equal amounts", () => {
    const items = [
      { ...base, id: "a", entityId: "pt", bankAccountId: "bca", date: d("2026-08-01"), description: "TRSF E-BANKING KE MANDIRI", amount: -10_000_000n },
      { ...base, id: "b", entityId: "pt", bankAccountId: "mdr", date: d("2026-08-02"), description: "TRANSFER DARI BCA", amount: 10_000_000n, direction: "IN" as const },
      { ...base, id: "c", entityId: "pt", bankAccountId: "bca", date: d("2026-08-05"), description: "TRSF E-BANKING ANDI WIJAYA", amount: -5_000_000n },
      { ...base, id: "d", entityId: "own", bankAccountId: "bri", date: d("2026-08-05"), description: "TRANSFER DARI PT UJI SEJAHTERA", amount: 5_000_000n, direction: "IN" as const },
      { ...base, id: "e", entityId: "pt", bankAccountId: "bca", date: d("2026-08-07"), description: "PEMBAYARAN SUPPLIER", amount: -1_000_000n },
      { ...base, id: "f", entityId: "pt", bankAccountId: "mdr", date: d("2026-08-07"), description: "PENERIMAAN PELANGGAN", amount: 1_000_000n, direction: "IN" as const },
    ];
    const own = [
      { entityId: "pt", names: ["PT UJI SEJAHTERA"] },
      { entityId: "own", names: ["ANDI WIJAYA"] },
    ];
    const r = matchTransfers(items, own);
    expect(r.get("a")?.accountCode).toBe("1199");
    expect(r.get("b")?.matchedTxId).toBe("a");
    expect(r.get("c")?.accountCode).toBe("1190");
    expect(r.get("d")?.accountCode).toBe("1190");
    expect(r.has("e")).toBe(false);
    expect(r.has("f")).toBe(false);
  });
});

describe("transfer matcher — pending counterpart", () => {
  it("own-name transfer with no pair yet goes to 1199, other-entity name to 1190", () => {
    const d = new Date("2026-08-13T00:00:00Z");
    const items = [
      { id: "x", entityId: "own", bankAccountId: "bca", date: d, description: "TRSF E-BANKING DB 1308 ANDI WIJAYA KE BRI", merchantKey: "", direction: "OUT" as const, amount: -9_000_000n },
      { id: "y", entityId: "own", bankAccountId: "bca", date: d, description: "TRSF E-BANKING DB PT UJI SEJAHTERA SETOR MODAL", merchantKey: "", direction: "OUT" as const, amount: -1_000_000n },
    ];
    const own = [
      { entityId: "pt", names: ["PT UJI SEJAHTERA"] },
      { entityId: "own", names: ["ANDI WIJAYA"] },
    ];
    const r = matchTransfers(items, own);
    expect(r.get("x")?.accountCode).toBe("1199");
    expect(r.get("y")?.accountCode).toBe("1190");
  });
});

describe("tax payments as banks print them", () => {
  const rules = sortRules(FIRM_RULES.map((r) => ({ ...r, clientId: null })));
  const code = (text: string) => {
    const m = matchRule(rules, text, "OUT");
    return m && [m.accountCode, m.taxTag];
  };

  it("files by the KAP-KJS code of the state receipt", () => {
    expect(code("DJP ONLINE SSP 411121-100 MASA 02")).toEqual(["2140", "PPH_21"]);
    expect(code("MPN G2 411124-104 NTPN 0A1B2C")).toEqual(["2141", "PPH_23"]);
    expect(code("MPN G3 BILLING 411128-420 PPH FINAL UMKM")).toEqual(["2145", "PPH_4_2"]);
    expect(code("PEMBAYARAN PAJAK 411125-100 MASA 03")).toEqual(["1180", "PPH_25"]);
    expect(code("PEMBAYARAN PAJAK 411125-200 TAHUN 2025")).toEqual(["2146", null]);
    expect(code("MPN 411211-100 MASA JAN")).toEqual(["2130", "PPN_KELUARAN"]);
  });

  it("a client rule gives way only to a firm rule that says strictly more about the same text", () => {
    const withClient = sortRules([
      ...FIRM_RULES.map((r) => ({ ...r, clientId: null })),
      { pattern: "PAJAK", direction: "OUT" as const, accountCode: "2130", taxTag: null, priority: 60, clientId: "c1" },
      { pattern: "BUNGA", direction: "IN" as const, accountCode: "4910", taxTag: null, priority: 60, clientId: "c1" },
    ]);
    expect(matchRule(withClient, "PAJAK BUNGA", "OUT")?.accountCode).toBe("8200");
    expect(matchRule(withClient, "PAJAK MASA MARET", "OUT")?.accountCode).toBe("2130");
    // Same pattern, not more specific: the client's choice stands.
    expect(matchRule(withClient, "BUNGA JASA", "IN")?.accountCode).toBe("4910");
  });

  it("suggests a tax liability for review when the text names no tax, never an expense", () => {
    for (const text of ["MPN G2 PENERIMAAN NEGARA 123456789012345", "BAYAR PAJAK KPP PRATAMA", "DJP ONLINE KODE BILLING 012345678901234"]) {
      expect(taxPaymentSuggestion(text, "OUT")).toMatchObject({ method: "HEURISTIC", accountCode: "2145" });
    }
    for (const text of ["PAJAK KENDARAAN SAMSAT B 1234 XY", "PBB 2026 KANTOR", "PEMBAYARAN BILLING TELKOMSEL"]) {
      expect(taxPaymentSuggestion(text, "OUT")).toBeNull();
    }
    expect(taxPaymentSuggestion("RESTITUSI PAJAK DJP", "IN")).toBeNull();
  });
});

describe("transfer hints", () => {
  it("pairs a transfer written TRF between the PT and its owner", () => {
    const d = (day: number) => new Date(Date.UTC(2026, 0, day));
    const items = [
      { id: "a", entityId: "pt", bankAccountId: "bca", date: d(5), amount: -25_000_000n, description: "TRSF E-BANKING DB 0501 BUDI SANTOSO" },
      { id: "b", entityId: "owner", bankAccountId: "bri", date: d(5), amount: 25_000_000n, description: "TRF DR PT MAJU BERSAMA" },
    ];
    const m = matchTransfers(items, []);
    expect(m.get("b")?.accountCode).toBe("1190");
    expect(m.get("a")?.accountCode).toBe("1190");
  });
});

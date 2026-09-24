import { describe, expect, it } from "vitest";
import { parseStatement } from "@/lib/import/parsers";
import { checkContinuity, merchantKey } from "@/lib/import/normalize";
import { matchRule, sortRules, FIRM_RULES } from "@/lib/classify/rules";
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
  });
});

describe("rules", () => {
  it("client rules win over firm rules; direction respected", () => {
    const rules = sortRules([
      ...FIRM_RULES.map((r) => ({ ...r, clientId: null })),
      { pattern: "BIAYA ADM", direction: "OUT" as const, accountCode: "6190", taxTag: null, priority: 99, clientId: "c1" },
    ]);
    expect(matchRule(rules, "BIAYA ADM BULAN AGUSTUS", "OUT")?.accountCode).toBe("6190");
    expect(matchRule(rules, "BUNGA", "OUT")).toBeNull();
    expect(matchRule(rules, "PAJAK BUNGA", "OUT")?.taxTag).toBe("PPH_4_2");
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

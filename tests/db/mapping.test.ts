import { beforeEach, describe, expect, it } from "vitest";
import { db, makeGroup, resetDb } from "../helpers";
import { AiAnswerError, MockProvider, type AiProvider } from "@/lib/ai/provider";
import { acceptMappings, deterministicSuggestion, inferType, MappingError, suggestMappings } from "@/lib/ledger-import/mapping";
import { COA_TEMPLATE } from "@/lib/coa/template";

const chart = COA_TEMPLATE.map((a) => ({ code: a.code, name: a.name, type: a.type, fsLine: a.fsLine, isBank: false, isSuspense: !!a.isSuspense, isClearing: !!a.isClearing }));
const sug = (name: string, code = "99999") => deterministicSuggestion({ code, name, typeHint: null }, { accounts: chart, priorByName: new Map() })?.accountCode ?? null;

describe("deterministic mapping", () => {
  it("maps typical Indonesian and English account names", () => {
    expect(sug("Petty Cash - Home Office")).toBe("1110");
    expect(sug("Bank OCBC - 601459993201 - USD")).toBe("1120");
    expect(sug("Long Term Non-Bank - Chickin PTE LTD")).toBe("2300");
    expect(sug("Short Term Non-Bank Payable - P2P")).toBe("2120");
    expect(sug("Loan to Subsidiary")).toBe("1140");
    expect(sug("Capital Placement - PT Chickin Ayam Hidup")).toBe("1260");
    expect(sug("Accumulated Depreciation Mini Kitchen - Machine")).toBe("1219");
    expect(sug("Depreciation Expense Smart Farm - Equipment")).toBe("6180");
    expect(sug("Income Tax Payable - Article 21")).toBe("2140");
    expect(sug("Preffered Shares")).toBe("3100");
    expect(sug("Premium on Stock")).toBe("3110");
    expect(sug("Accured Expenses")).toBe("2150");
    expect(sug("Other Revenue - Bank Interest")).toBe("4900");
    expect(sug("Expense Bank Administration", "41000")).toBe("7100");
    expect(sug("Foreign Exchange Loss/Gain", "35000")).toBe("7200");
    expect(sug("Kas")).toBe("1110");
    expect(sug("Platform Fee - Gofood")).toBeNull();
    // Found in the Goers/Chickin walk: staff loans are other receivables; rent is an expense whatever was rented.
    expect(sug("Account Receivable - Employee Loan", "1-1303")).toBe("1140");
    expect(sug("Piutang Karyawan")).toBe("1140");
    expect(sug("Account Receivable", "1-1200")).toBe("1130");
    expect(sug("Sewa Peralatan Tata Suara", "9106")).toBe("6120");
    expect(sug("Sewa Dibayar Dimuka")).toBe("1170");
    expect(sug("Jaminan Sewa Gedung Konser", "9102")).toBe("1170");
    expect(sug("Rental Deposit")).toBe("1170");
    expect(sug("Salary Advance")).toBe("1170");
    expect(sug("Piutang Sewa")).toBe("1140");
    expect(sug("Pendapatan Sewa")).not.toBe("6120");
    expect(sug("Utang Gaji")).not.toBe("6100");
  });

  it("infers type from the name before the code", () => {
    expect(inferType("41000", "Expense Bank Administration")).toBe("BEBAN");
    expect(inferType("35000", "Foreign Exchange Loss/Gain")).toBe("BEBAN");
    expect(inferType("2-2744", "Others Payables-Related Parties")).toBe("LIABILITAS");
    expect(inferType("1-1000", "BANK")).toBe("ASET");
    expect(inferType("5-5016", "Cloud - AWS")).toBe("BEBAN");
  });

  it("prefers an exact client-account name and prior mappings", () => {
    expect(deterministicSuggestion({ code: "X", name: "Piutang Usaha", typeHint: null }, { accounts: chart, priorByName: new Map() })).toMatchObject({ method: "NAME", accountCode: "1130" });
    expect(deterministicSuggestion({ code: "X", name: "Cloud - AWS", typeHint: null }, { accounts: chart, priorByName: new Map([["cloud aws", "5110"]]) })).toMatchObject({ method: "PRIOR", accountCode: "5110" });
  });
});

describe("suggestMappings + acceptMappings", () => {
  beforeEach(resetDb);

  async function sources(g: Awaited<ReturnType<typeof makeGroup>>, names: string[]) {
    return Promise.all(names.map((name, i) => db.sourceAccount.create({ data: { firmId: g.firm.id, clientId: g.client.id, entityId: g.pt.entity.id, code: `S${i}`, name } })));
  }

  it("suggests without mapping, uses AI only for leftovers, caches, and never applies on its own", async () => {
    const g = await makeGroup();
    const [kas, gofood, grab] = await sources(g, ["Kas Kecil Kantor", "Platform Fee - Gofood", "Platform Fee - Grabfood"]);
    const provider = new MockProvider({ "Platform Fee - Gofood": { accountCode: "6150", confidence: 0.7, taxTag: null, reason: "komisi platform" }, "Platform Fee - Grabfood": { accountCode: "9999", confidence: 0.9, taxTag: null, reason: "kode palsu" } });
    const r1 = await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider, useAi: true });
    expect(r1).toMatchObject({ pending: 3, deterministic: 1, calls: 1, aiAnswered: 1 });
    const after = await db.sourceAccount.findMany({ where: { id: { in: [kas.id, gofood.id, grab.id] } }, orderBy: { code: "asc" } });
    expect(after.map((s) => [s.suggestedCode, s.suggestedBy, s.accountId])).toEqual([
      ["1110", "KEYWORD", null],
      ["6150", "AI", null],
      [null, null, null],
    ]);
    // AI answers are cached: a second run makes no call for Gofood; Grabfood's invalid code was dropped and is asked again.
    const provider2 = new MockProvider({});
    const r2 = await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider: provider2, useAi: true });
    expect(r2.cacheHits).toBe(1); // Gofood suggestion reused only after current model/context cache validation
    expect(provider2.calls).toBe(1);
    expect(await db.aiUsage.count()).toBe(2);
  });

  it("a truncated AI answer is a failed, billed call with a clear note — nothing suggested or cached", async () => {
    const g = await makeGroup();
    await sources(g, ["Royalti Artis Terutang"]);
    const provider: AiProvider = {
      model: "glm-5.3",
      classify: async () => ({ answers: [], promptTokens: 0, completionTokens: 0, model: "glm-5.3" }),
      mapAccounts: async () => {
        throw new AiAnswerError("Jawaban AI terpotong (batas 1560 token). Coba lagi atau pilih model lain.", 1354, 1560, "glm-5.3");
      },
    };
    const r = await suggestMappings(db, { firmId: g.firm.id, clientId: g.client.id, provider, useAi: true });
    expect(r).toMatchObject({ calls: 1, aiAnswered: 0 });
    expect(r.note).toMatch(/^AI gagal: Jawaban AI terpotong/);
    const usage = await db.aiUsage.findFirstOrThrow();
    expect([usage.ok, usage.promptTokens, usage.completionTokens, usage.model]).toEqual([false, 1354, 1560, "glm-5.3"]);
    expect(await db.aiAccountMap.count()).toBe(0);
    expect(await db.sourceAccount.count({ where: { suggestedBy: "AI" } })).toBe(0);
  });

  it("accepts mappings explicitly, creates new accounts under an FS line, refuses special accounts", async () => {
    const g = await makeGroup();
    const [a, b] = await sources(g, ["Cloud - AWS", "Platform Fee - QRIS"]);
    await acceptMappings(db, g.client.id, [
      { sourceAccountId: a.id, accountCode: "5110", method: "MANUAL" },
      { sourceAccountId: b.id, newAccount: { fsLine: "BEBAN_UMUM_ADM", name: "Beban Platform" }, method: "NEW" },
    ]);
    const mapped = await db.sourceAccount.findMany({ where: { clientId: g.client.id }, include: { account: true }, orderBy: { code: "asc" } });
    expect(mapped.map((m) => [m.account?.code, m.mappedBy])).toEqual([
      ["5110", "MANUAL"],
      ["6191", "NEW"],
    ]);
    expect((await db.client.findUniqueOrThrow({ where: { id: g.client.id } })).coaVersion).toBe(2);
    await expect(acceptMappings(db, g.client.id, [{ sourceAccountId: a.id, accountCode: "1999", method: "MANUAL" }])).rejects.toThrow(MappingError);
    await expect(acceptMappings(db, g.client.id, [{ sourceAccountId: a.id, accountCode: "1101", method: "MANUAL" }])).rejects.toThrow(MappingError);
  });
});

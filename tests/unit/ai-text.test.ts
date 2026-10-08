import { describe, expect, it } from "vitest";
import { buildCloseReviewPrompt, buildControlExplainPrompt, parseControlExplain, tidyAiText, type ControlExplainInput } from "@/lib/ai/provider";

describe("AI text for the accountant", () => {
  it("drops words in another script and ends on a whole sentence", () => {
    expect(tidyAiText("setiap penjualan seharusnya匹配的 dengan HPP.", 400)).toBe("setiap penjualan seharusnya dengan HPP.");
    expect(tidyAiText("Pastikan nilai最终 disetujui direksi.", 400)).toBe("Pastikan nilai disetujui direksi.");
    const long = `${"Kalimat pertama cukup panjang untuk diuji. ".repeat(8)}Kalimat terakhir terpotong di tengah kata`;
    const out = tidyAiText(long, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
  });

  const input: ControlExplainInput = {
    client: "Grup Uji", period: "Juni 2026", currency: "IDR", canDraft: false,
    accounts: [{ code: "1190", name: "Piutang/Utang Antar Entitas" }],
    control: { key: "sanity:e1", title: "Penjualan tanpa harga pokok", scope: "PT Uji", status: "REVIEW", detail: "Penjualan Rp 518.240.000", rows: [] },
    entities: [{ scope: "PT Uji", name: "PT Uji Sejahtera", kind: "PT", currency: "IDR", banks: ["1101"] }, { scope: "Andi", name: "Andi Wijaya", kind: "PERORANGAN", currency: "IDR", banks: ["1102", "1103"] }],
  };

  it("tells the model whose books, with house rules, and no lettered fix types to echo", () => {
    const p = buildControlExplainPrompt(input);
    expect(p.system).toContain("PT, CV dan badan usaha asing tidak punya Prive");
    expect(p.system).toContain("7200");
    expect(p.system).not.toMatch(/\(a\)|\(d\)/);
    expect(JSON.parse(p.user).entities[1]).toEqual({ scope: "Andi", name: "Andi Wijaya", kind: "PERORANGAN", currency: "IDR", banks: ["1102", "1103"] });
    const r = buildCloseReviewPrompt({ client: "Grup Uji", period: "Juni 2026", accounts: [], controls: [input.control], entities: input.entities });
    expect(r.system).toContain("1181 (itu PPh badan lebih bayar)");
    expect(JSON.parse(r.user).entities).toHaveLength(2);
  });

  it("cleans the parsed explanation the same way", () => {
    const a = parseControlExplain(JSON.stringify({ explanation: "Pembelian mungkin dibayar pemilik最终.", suggestion: "", refs: [], note: "", entry: null }), input);
    expect(a.explanation).toBe("Pembelian mungkin dibayar pemilik.");
  });
});

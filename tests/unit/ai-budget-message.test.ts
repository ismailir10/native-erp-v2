import { describe, expect, it } from "vitest";
import { budgetExceededMessage } from "@/lib/ai/budget";

describe("the AI budget refusal", () => {
  it("says what is used, what was needed and who can raise the limit — never a setting or variable name", () => {
    const m = budgetExceededMessage(185_000, 40_000, 200_000);
    expect(m).toBe("Kuota token AI bulan ini tidak cukup: terpakai 185.000 dari 200.000 token, permintaan ini butuh sekitar 40.000. Lanjutkan manual, atau hubungi Buku untuk menaikkan batas bulanan.");
    expect(m).not.toMatch(/Pengaturan|AI_MONTHLY_TOKEN_BUDGET/);
  });
});

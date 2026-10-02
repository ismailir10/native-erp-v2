import { describe, expect, it } from "vitest";
import { counterpartyOf, parseWorkspacePeriod, workspaceHref, workspaceQuestionIntent } from "@/lib/workspace";

describe("shared workspace context", () => {
  it.each(["2026-00", "2026-13", "2026-8", "26-08", "2026-08-01", "0000-08", "2999-01"])("rejects invalid period %s instead of silently changing it", value => {
    expect(() => parseWorkspacePeriod(value)).toThrow(/periode/);
  });
  it("keeps origin context on drilldown and overrides stale periods", () => {
    const href = workspaceHref("/clients/group/ledger/1101?entity=company&period=2025-02", { key: "all", period: "2026-08" });
    const query = new URL(href, "https://buku.example").searchParams;
    expect(query.get("scope")).toBe("all");
    expect(query.get("entity")).toBe("company");
    expect(query.getAll("period")).toEqual(["2026-08"]);
  });
  it("bounds supported intents and keeps source questions separate from books", () => {
    expect(workspaceQuestionIntent("Berapa laba dari dokumen laporan unggahan?")).toBe("evidence");
    expect(workspaceQuestionIntent("Apa yang menghambat tutup buku?")).toBe("readiness");
    expect(workspaceQuestionIntent("Profil perusahaan")).toBe("context");
    expect(workspaceQuestionIntent("Kirim undangan untuk tim")).toBe("unsupported");
    expect(workspaceQuestionIntent("Berapa total transfer BCA PT ke ALFI YANDRA bulan Juni dan dicatat ke akun apa?")).toBe("transactions");
    expect(workspaceQuestionIntent("Pembayaran dari DINA PUSPITA?")).toBe("transactions");
    expect(workspaceQuestionIntent("Berapa saldo bank?")).toBe("balances");
    // Asking Buku to act is refused (UC-X5); asking about the same words is not.
    expect(workspaceQuestionIntent("Tolong ubah akun transaksi PLN ke 6100")).toBe("change");
    expect(workspaceQuestionIntent("Hapus impor bulan Juni")).toBe("change");
    expect(workspaceQuestionIntent("bisakah reklasifikasi beban sewa ke 1170")).toBe("change");
    expect(workspaceQuestionIntent("Koreksi fiskal berapa tahun ini?")).not.toBe("change");
    expect(workspaceQuestionIntent("Catatan apa yang perlu ditanyakan ke klien?")).toBe("unclear");
  });

  it("reads the counterparty named in a question", () => {
    expect(counterpartyOf("Berapa total transfer BCA PT ke ALFI YANDRA bulan Juni dan dicatat ke akun apa?")).toBe("ALFI YANDRA");
    expect(counterpartyOf("pembayaran dari Dina Puspita?")).toBe("Dina Puspita");
    expect(counterpartyOf('mutasi dengan "PT PAKAN JAYA" bulan ini')).toBe("PT PAKAN JAYA");
    expect(counterpartyOf("transfer ke rekening giro")).toBeNull();
    expect(counterpartyOf("dicatat ke akun apa")).toBeNull();
  });
});

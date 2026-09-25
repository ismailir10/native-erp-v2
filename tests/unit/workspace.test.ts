import { describe, expect, it } from "vitest";
import { parseWorkspacePeriod, workspaceHref, workspaceQuestionIntent } from "@/lib/workspace";

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
  });
});

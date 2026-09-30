import { describe, expect, it } from "vitest";
import { FRAMEWORK_OPTIONS, isFramework, scopeFramework, signatoryOf, standardOf, statementNames } from "@/lib/reports/framework";

describe("reporting framework helpers", () => {
  it("knows exactly the three frameworks", () => {
    expect(FRAMEWORK_OPTIONS.map((o) => o.value)).toEqual(["SAK_EMKM", "SAK_EP", "SAK_UMUM"]);
    expect(isFramework("SAK_EP")).toBe(true);
    expect(isFramework("IFRS")).toBe(false);
    for (const o of FRAMEWORK_OPTIONS) expect(o.help.length).toBeGreaterThan(20);
  });

  it("names the standard and the statements per framework", () => {
    expect(standardOf("SAK_EMKM").short).toBe("SAK EMKM");
    expect(standardOf("SAK_EP").full).toBe("Standar Akuntansi Keuangan Entitas Privat");
    expect(standardOf("SAK_UMUM").full).toMatch(/berlaku umum/);
    expect(statementNames("SAK_EMKM")).toMatchObject({ position: "Laporan Posisi Keuangan", income: "Laporan Laba Rugi" });
    expect(statementNames("SAK_EP").income).toBe("Laporan Laba Rugi dan Penghasilan Komprehensif Lain");
    expect(statementNames("SAK_UMUM").income).toBe("Laporan Laba Rugi dan Penghasilan Komprehensif Lain");
  });

  it("a group uses the most demanding framework in it", () => {
    expect(scopeFramework([{ reportingFramework: "SAK_EMKM" }])).toBe("SAK_EMKM");
    expect(scopeFramework([{ reportingFramework: "SAK_EMKM" }, { reportingFramework: "SAK_EP" }])).toBe("SAK_EP");
    expect(scopeFramework([{ reportingFramework: "SAK_EP" }, { reportingFramework: "SAK_UMUM" }, { reportingFramework: "SAK_EMKM" }])).toBe("SAK_UMUM");
    expect(scopeFramework([])).toBe("SAK_EP");
  });

  it("signs with Direksi only when the scope holds a corporation", () => {
    expect(signatoryOf([{ kind: "PT" }]).body).toBe("Direksi");
    expect(signatoryOf([{ kind: "BADAN_USAHA_ASING" }]).body).toBe("Direksi");
    expect(signatoryOf([{ kind: "PT" }, { kind: "PERORANGAN" }]).body).toBe("Direksi");
    expect(signatoryOf([{ kind: "CV" }]).body).toBe("Pemilik/Pengurus");
    expect(signatoryOf([{ kind: "PERORANGAN" }]).body).toBe("Pemilik/Pengurus");
    expect(signatoryOf([{ kind: "CV" }, { kind: "PERORANGAN" }]).body).toBe("Pemilik/Pengurus");
  });
});

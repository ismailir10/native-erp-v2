import { describe, expect, it } from "vitest";
import { directorsStatement } from "@/lib/reports/notes";
import { signatoryOf } from "@/lib/reports/framework";

describe("directors' statement per framework x signatory", () => {
  const asOf = new Date(Date.UTC(2026, 11, 31));
  const kinds = [["PT", "SURAT PERNYATAAN DIREKSI", "Direktur"], ["CV", "SURAT PERNYATAAN PEMILIK/PENGURUS", "Pemilik/Pengurus"], ["PERORANGAN", "SURAT PERNYATAAN PEMILIK/PENGURUS", "Pemilik/Pengurus"]] as const;
  const standard = { SAK_EMKM: /Entitas Mikro, Kecil, dan Menengah \(SAK EMKM\)/, SAK_EP: /Standar Akuntansi Keuangan Entitas Privat;/, SAK_UMUM: /berlaku umum di Indonesia/ } as const;
  for (const fw of ["SAK_EMKM", "SAK_EP", "SAK_UMUM"] as const) {
    for (const [kind, title, role] of kinds) {
      it(`${fw} / ${kind}`, () => {
        const t = directorsStatement("Usaha Maju", asOf, fw, signatoryOf([{ kind }]));
        expect(t[0]).toBe(title);
        expect(t.join("\n")).toMatch(standard[fw]);
        expect(t.at(-1)).toBe(role);
        expect(t.find((l) => l.startsWith("Nama:"))).toContain(`Jabatan: ${role}`);
        if (kind !== "PT") expect(t.join("\n")).not.toMatch(/Direksi|Direktur/);
      });
    }
  }
});

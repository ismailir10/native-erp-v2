import type { EntityKind, ReportingFramework } from "@/lib/generated/prisma/enums";

/**
 * The reporting framework an entity's report set names (Entity.reportingFramework). It changes wording only — the CALK basis, the
 * statement titles, which policies the notes describe and who signs the statement of responsibility — never a number. The report
 * page, the notes and the Excel workbook all read it from here, so they cannot disagree.
 */
export type Framework = ReportingFramework;

export const FRAMEWORK_OPTIONS: { value: Framework; label: string; help: string }[] = [
  { value: "SAK_EMKM", label: "SAK EMKM", help: "Usaha mikro dan kecil. Tanpa pajak tangguhan, aset hak guna dan penghasilan komprehensif lain; arus kas tidak wajib." },
  { value: "SAK_EP", label: "SAK EP", help: "Entitas privat tanpa akuntabilitas publik. Pilihan umum untuk PT dan CV yang laporannya dipakai bank, investor atau pajak." },
  { value: "SAK_UMUM", label: "SAK Umum (PSAK)", help: "PSAK penuh, untuk entitas yang wajib atau memilih menerapkan standar yang berlaku umum." },
];

export const isFramework = (v: unknown): v is Framework => FRAMEWORK_OPTIONS.some((o) => o.value === v);

const STANDARD: Record<Framework, { short: string; full: string }> = {
  SAK_EMKM: { short: "SAK EMKM", full: "Standar Akuntansi Keuangan Entitas Mikro, Kecil, dan Menengah (SAK EMKM)" },
  SAK_EP: { short: "SAK EP", full: "Standar Akuntansi Keuangan Entitas Privat" },
  SAK_UMUM: { short: "SAK Umum", full: "Standar Akuntansi Keuangan yang berlaku umum di Indonesia (PSAK)" },
};
export const standardOf = (f: Framework) => STANDARD[f];

/** The statements' own names; SAK EMKM has no other comprehensive income and requires only position, income and CALK. */
export function statementNames(f: Framework) {
  return {
    position: "Laporan Posisi Keuangan",
    income: f === "SAK_EMKM" ? "Laporan Laba Rugi" : "Laporan Laba Rugi dan Penghasilan Komprehensif Lain",
    equity: f === "SAK_EMKM" ? "Laporan Perubahan Ekuitas (informasi tambahan)" : "Laporan Perubahan Ekuitas",
    cashFlow: f === "SAK_EMKM" ? "Laporan Arus Kas (informasi tambahan, metode tidak langsung)" : "Laporan Arus Kas (metode tidak langsung)",
  };
}

const RANK: Record<Framework, number> = { SAK_EMKM: 0, SAK_EP: 1, SAK_UMUM: 2 };

/** A group's report set follows the most demanding framework among its entities; no entities = the default. */
export function scopeFramework(entities: { reportingFramework: Framework }[]): Framework {
  return entities.reduce<Framework>((top, e) => (RANK[e.reportingFramework] > RANK[top] ? e.reportingFramework : top), entities.length ? "SAK_EMKM" : "SAK_EP");
}

export type Signatory = { body: "Direksi" | "Pemilik/Pengurus"; title: string; sheet: string; role: string };

/** Only a PT or a foreign company has a Direksi; a CV, a firm or an individual is signed by its owner / management. */
export function signatoryOf(entities: { kind: EntityKind }[]): Signatory {
  const corporate = entities.some((e) => e.kind === "PT" || e.kind === "BADAN_USAHA_ASING");
  return corporate
    ? { body: "Direksi", title: "SURAT PERNYATAAN DIREKSI", sheet: "Pernyataan Direksi", role: "Direktur" }
    : { body: "Pemilik/Pengurus", title: "SURAT PERNYATAAN PEMILIK/PENGURUS", sheet: "Pernyataan Pengurus", role: "Pemilik/Pengurus" };
}

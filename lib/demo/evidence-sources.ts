import { createHash } from "node:crypto";
import { extractEvidence } from "@/lib/evidence/extract";
import type { DemoEvidenceSource } from "./evidence-answers";

/** Invented, versioned fixtures only. Never load firm records or connected Drive data here. */
const SOURCES = [
  {
    id: "synthetic-profile-v1", name: "Profil Citra Ternak.txt",
    text: "Citra Ternak Holdings Pte. Ltd.\nCompany profile\nBusiness: distribusi pakan ternak\nFinancial year ends 31 January\nReporting currency: USD\nSemua nama dan angka dalam contoh ini adalah rekaan.",
  },
  ...[2023, 2024].map(year => ({
    id: `synthetic-report-${year}-v1`, name: `Laporan keuangan ${year}.txt`,
    text: `Citra Ternak Holdings Pte. Ltd.\nFinancial statements\nYear ended 31 January ${year}\nAmounts in USD\nPendapatan: ${year === 2023 ? "1000.00" : "1250.00"}\nLaba bersih: ${year === 2023 ? "200.00" : "300.00"}\nSemua nama dan angka dalam contoh ini adalah rekaan.`,
  })),
];

export async function loadPublicEvidenceDemo(): Promise<DemoEvidenceSource[]> {
  return Promise.all(SOURCES.map(async source => {
    const extracted = await extractEvidence(source.name, Buffer.from(source.text));
    return { id: source.id, name: source.name, hash: createHash("sha256").update(source.text).digest("hex"), units: extracted.units };
  }));
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getClientForFirm } from "@/lib/tenant";
import { ocrDraft } from "@/lib/ocr/draft";
import { OcrError } from "@/lib/ocr/pages";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { OcrReview } from "@/components/app/ocr-review";

export const metadata = { title: "Periksa baris" };

export default async function OcrDraftPage({ params }: { params: Promise<{ id: string; draftId: string }> }) {
  const { id, draftId } = await params;
  const client = await getClientForFirm(id).catch(() => notFound());
  const draft = await ocrDraft(prisma, client.firmId, client.id, draftId).catch((e) => (e instanceof OcrError ? notFound() : Promise.reject(e)));
  const bank = client.entities.flatMap((e) => e.bankAccounts.map((b) => ({ ...b, entity: e.name }))).find((b) => b.id === draft.bankAccountId);
  const s = (v: bigint | null) => (v === null ? "" : v.toString());
  const mapped = draft.source === "MAPPING";
  const where = bank ? `${bank.entity} · ${bank.label} ${bank.number}` : "rekening";
  return (
    <div className="space-y-6">
      <PageHeader
        title={mapped ? "Periksa baris rekening koran" : "Periksa scan rekening koran"}
        description={mapped ? `${draft.fileName} · dibaca dengan pemetaan kolom · ${where}` : `${draft.fileName} · ${draft.pages} halaman · disalin AI (${draft.model}) · ${where}`}
      />
      {draft.status === "IMPORTED" ? (
        <NextStep tone="done" href={`/clients/${client.id}/review`} cta="Buka Review transaksi">{mapped ? "File ini sudah diimpor" : "Scan ini sudah diimpor"}. Transaksinya masuk ke buku besar seperti file lain; yang perlu dicek ada di Review transaksi.</NextStep>
      ) : draft.proof.importable ? (
        <NextStep>Semua baris terbukti oleh saldo berjalan. Periksa sekilas, lalu impor.</NextStep>
      ) : (
        <NextStep>Ada {draft.proof.problems} hal yang perlu diperiksa pada tanggal, nominal, atau saldo. {mapped ? "Bandingkan dengan file (atau kembali dan atur kolomnya lagi)" : "Bandingkan dengan scan"}, betulkan angkanya, lalu impor.</NextStep>
      )}
      <OcrReview
        clientId={client.id}
        draftId={draft.id}
        imported={draft.status === "IMPORTED"}
        openingSource={draft.header.openingSource}
        source={draft.source}
        initial={{ opening: s(draft.opening), closing: s(draft.closing), rows: draft.rows.map((r) => ({ date: r.date, description: r.description, debit: s(r.debit), credit: s(r.credit), balance: s(r.balance) })) }}
      />
    </div>
  );
}

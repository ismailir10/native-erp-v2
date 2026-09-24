import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate } from "@/lib/format";
import { FS_LINES } from "@/lib/coa/template";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ReviewQueue } from "@/components/app/review-queue";

const TYPE_LABEL: Record<string, string> = { ASET: "Aset", LIABILITAS: "Liabilitas", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, base } = await loadClientPage(params, searchParams);
  const txs = await prisma.bankTransaction.findMany({
    where: { bankAccount: { entity: { clientId: client.id } }, status: "NEEDS_REVIEW" },
    include: { bankAccount: { include: { entity: true } } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const accounts = await prisma.account.findMany({ where: { clientId: client.id, isBank: false, isSuspense: false }, orderBy: { code: "asc" } });
  const similarCount = new Map<string, number>();
  for (const t of txs) similarCount.set(`${t.merchantKey}|${t.direction}`, (similarCount.get(`${t.merchantKey}|${t.direction}`) ?? 0) + 1);

  const items = txs.map((t) => ({
    id: t.id,
    date: formatDate(t.date),
    entity: t.bankAccount.entity.shortName,
    bank: t.bankAccount.label,
    description: t.description,
    amount: t.amount.toString(),
    method: t.method,
    confidence: t.confidence,
    reason: t.reason,
    suggestedCode: t.suggestedCode,
    taxTag: t.taxTag,
    similar: similarCount.get(`${t.merchantKey}|${t.direction}`) ?? 1,
  }));
  const options = accounts.map((a) => ({ code: a.code, name: a.name, group: `${TYPE_LABEL[a.type]} · ${FS_LINES[a.fsLine as keyof typeof FS_LINES]?.label ?? ""}`.replace(/ · $/, "") }));

  return (
    <div className="space-y-6">
      <PageHeader title="Review" description={`${client.name} · ${txs.length} transaksi menunggu keputusan Anda`} />
      {txs.length > 0 ? (
        <NextStep>
          Cek usulan akun. Tekan <b>Enter</b> untuk menerima, atau ganti akunnya. Buku mengingat pilihan Anda untuk impor berikutnya.
        </NextStep>
      ) : (
        <NextStep href={`${base}/close`} cta="Tutup buku" tone="done">Semua transaksi sudah terklasifikasi.</NextStep>
      )}
      <ReviewQueue items={items} accounts={options} />
    </div>
  );
}

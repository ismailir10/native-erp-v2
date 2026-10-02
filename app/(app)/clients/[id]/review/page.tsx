import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate } from "@/lib/format";
import { classifiableOptions } from "@/lib/coa/options";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { withParams } from "@/lib/scope";
import { ScopeBar } from "@/components/app/scope-bar";
import { ReviewQueue } from "@/components/app/review-queue";
import { isGenericKey } from "@/lib/import/normalize";
import { simpleGuessRows } from "@/lib/ai/retry";
import { isSimpleGuess } from "@/lib/classify/fallback";
import { resolveAiConfig } from "@/lib/settings/ai";
import { getCurrentMember } from "@/lib/tenant";

export const metadata = { title: "Review transaksi" };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, base, scope, period, scopeLabel, entityOptions, periodOptions } = await loadClientPage(params, searchParams);
  const txs = await prisma.bankTransaction.findMany({
    where: { firmId: client.firmId, entityId: { in: scope.entityIds }, date: { lte: period.end }, status: "NEEDS_REVIEW" },
    include: { bankAccount: { include: { entity: true } } },
    orderBy: [{ date: "asc" }, { rowNumber: "asc" }],
  });
  const simpleGuesses = (await simpleGuessRows(prisma, { clientId: client.id, entityIds: scope.entityIds, through: period.end })).length;
  const ai = await resolveAiConfig(prisma);
  const member = await getCurrentMember();
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
    currency: t.bankAccount.currency,
    method: t.method,
    confidence: t.confidence,
    reason: t.reason,
    suggestedCode: t.suggestedCode,
    taxTag: t.taxTag,
    // A key with no counterparty ("BI FAST OUTGOING") groups unrelated payments: never offered as *serupa*.
    similar: isGenericKey(t.merchantKey) ? 1 : (similarCount.get(`${t.merchantKey}|${t.direction}`) ?? 1),
    guess: isSimpleGuess(t),
  }));
  const options = classifiableOptions(accounts);

  return (
    <div className="space-y-6">
      <PageHeader title="Review transaksi" description={`${scopeLabel} · mutasi sampai ${formatDate(period.end)}, termasuk sisa periode sebelumnya`} actions={<ScopeBar entities={entityOptions} periods={periodOptions} entity={scope.value} period={period.key} />} />
      {txs.length > 0 ? (
        <NextStep>
          Cek usulan akun. Tekan <b>Enter</b> untuk menerima, atau ganti akunnya. Buku mengingat pilihan Anda untuk impor berikutnya; <b>Tebakan</b> tidak diterima dengan Enter dan tidak diingat sampai Anda memilih akunnya.
        </NextStep>
      ) : (
        <NextStep href={`${base}/close?entity=${scope.value}&period=${period.key}`} cta="Tutup buku" tone="done">Tidak ada transaksi menunggu review dalam cakupan ini.</NextStep>
      )}
      {txs.length > 0 && (
        <div className="flex justify-end">
          <a href={withParams(`${base}/review/export`, { entity: scope.value, period: period.key })} className={buttonVariants({ variant: "outline", size: "sm" })} download data-testid="questions-download">
            <Download /> Unduh daftar pertanyaan untuk klien (Excel)
          </a>
        </div>
      )}
      <ReviewQueue items={items} accounts={options} scope={{ entityIds: scope.entityIds, period: period.key }} clientId={client.id} simpleGuesses={simpleGuesses} aiReady={Boolean(ai.apiKey && ai.model)} canSetUpAi={member.role === "ADMIN"} />
    </div>
  );
}

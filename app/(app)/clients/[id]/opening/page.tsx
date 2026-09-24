import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getClientForFirm } from "@/lib/tenant";
import { openingContext } from "@/lib/opening";
import Link from "next/link";
import { formatDate, formatRupiah, toIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_CODES } from "@/lib/coa/template";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { OpeningForm } from "@/components/app/opening-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientForFirm(id).catch(() => notFound());
  const [ctx, accounts] = await Promise.all([
    openingContext(prisma, client.id),
    prisma.account.findMany({ where: { clientId: client.id, isBank: false, code: { notIn: [ACCOUNT_CODES.SUSPENSE, ACCOUNT_CODES.RETAINED, ACCOUNT_CODES.CLEARING] } }, orderBy: { code: "asc" } }),
  ]);
  // Entities whose ledger import brought its own opening rows don't need a separate Saldo Awal.
  const imported = new Set(
    (await prisma.journalEntry.findMany({ where: { entityId: { in: ctx.map((c) => c.entity.id) }, kind: "IMPORTED" }, select: { entityId: true }, distinct: ["entityId"] })).map((e) => e.entityId),
  );
  const missing = ctx.filter((c) => !c.existing && !imported.has(c.entity.id));
  const currencyOf = (entityId: string) => client.entities.find((e) => e.id === entityId)?.functionalCurrency ?? "IDR";

  return (
    <div className="space-y-6">
      <PageHeader title="Saldo Awal" description={`${client.name} · posisi keuangan sebelum transaksi pertama di Buku`} />
      {missing.length ? (
        <NextStep>
          Isi saldo awal {missing.map((m) => m.entity.shortName).join(" dan ")}. Tanpa saldo awal, saldo bank di buku besar tidak akan cocok dengan rekening koran.
        </NextStep>
      ) : (
        <NextStep tone="done" href={`/clients/${client.id}/import`} cta="Impor mutasi">Saldo awal semua entitas sudah dicatat.</NextStep>
      )}
      {ctx.map((c) => (
        <Card key={c.entity.id}>
          <CardHeader>
            <CardTitle>{c.entity.name}</CardTitle>
            <CardDescription>
              {c.existing
                ? `Dicatat per ${formatDate(c.existing.date)}. Koreksi lewat Jurnal Penyesuaian.`
                : imported.has(c.entity.id)
                  ? "Buku entitas ini berasal dari impor buku besar, termasuk saldo awalnya."
                  : "Selisih debit dan kredit otomatis masuk ke 3200 Saldo Laba."}
            </CardDescription>
          </CardHeader>
          <CardContent className={c.existing ? "px-0" : undefined}>
            {c.existing ? (
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="pl-6">Akun</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="pr-6 text-right">Kredit</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {c.existing.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6">{l.code} {l.name}</TableCell>
                      <TableCell className="num text-right">{l.debit ? formatMoney(l.debit, currencyOf(c.entity.id), { bare: true }) : "–"}</TableCell>
                      <TableCell className="num pr-6 text-right">{l.credit ? formatMoney(l.credit, currencyOf(c.entity.id), { bare: true }) : "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : imported.has(c.entity.id) ? null : (
              <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Punya neraca dari sistem lama (mis. Jurnal atau Accurate)?{" "}
                <Link className="font-medium text-primary hover:underline" href={`/clients/${client.id}/import?tab=ledger`}>Impor dari file neraca</Link>, lalu petakan akunnya.
              </p>
              <OpeningForm
                clientId={client.id}
                entityId={c.entity.id}
                suggestedDate={toIsoDate(c.suggestedDate)}
                banks={c.banks.map((b) => ({ accountCode: b.accountCode, label: b.label, prefill: b.statementOpening === null ? "" : formatRupiah(b.statementOpening, { bare: true }), source: b.source }))}
                accounts={accounts.map((a) => ({ code: a.code, name: a.name }))}
              />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

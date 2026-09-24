import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate } from "@/lib/format";
import { liveUploadFile } from "@/lib/demo/seed";
import { PageHeader } from "@/components/app/page-header";
import { ImportForm } from "@/components/app/import-form";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client } = await loadClientPage(params, searchParams);
  const banks = client.entities.flatMap((e) => e.bankAccounts.map((b) => ({ id: b.id, label: b.label, entity: e.name, bank: b.bank, number: b.number })));
  const imports = await prisma.statementImport.findMany({
    where: { bankAccountId: { in: banks.map((b) => b.id) } },
    include: { bankAccount: { include: { entity: true } } },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 30,
  });

  let sample: { bankAccountId: string; fileName: string } | undefined;
  if (process.env.DEMO_MODE === "true") {
    const f = await liveUploadFile();
    const acct = banks.find((b) => f.fileName.includes(b.number.slice(-4)) && f.fileName.startsWith(b.bank));
    const already = acct && imports.some((i) => i.bankAccountId === acct.id && i.fileName === f.fileName);
    if (acct && !already) sample = { bankAccountId: acct.id, fileName: f.fileName };
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Impor Mutasi" description={`${client.name} · setiap baris langsung jadi jurnal, lengkap dengan jejak ke file aslinya`} />
      <ImportForm clientId={client.id} banks={banks} sample={sample} />
      <Card>
        <CardHeader>
          <CardTitle>Riwayat impor</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">File</TableHead>
                <TableHead>Rekening</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Baris</TableHead>
                <TableHead>Saldo berjalan</TableHead>
                <TableHead className="pr-6">Diimpor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="pl-6 text-muted-foreground">Belum ada rekening koran yang diimpor untuk klien ini.</TableCell>
                </TableRow>
              )}
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-6 font-mono text-xs">{i.fileName}</TableCell>
                  <TableCell>{i.bankAccount.label} <span className="text-muted-foreground">· {i.bankAccount.entity.shortName}</span></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(i.periodStart)} – {formatDate(i.periodEnd)}</TableCell>
                  <TableCell className="num text-right">{i.rowCount}{i.duplicateCount ? <span className="text-muted-foreground"> ({i.duplicateCount} duplikat)</span> : null}</TableCell>
                  <TableCell><StatusPill status={i.continuityOk ? "PASS" : "REVIEW"} label={i.continuityOk ? "Nyambung" : "Ada celah"} /></TableCell>
                  <TableCell className="pr-6 text-muted-foreground">{formatDate(i.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

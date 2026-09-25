import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { formatDate } from "@/lib/format";
import { liveUploadFile } from "@/lib/demo/seed";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ImportForm } from "@/components/app/import-form";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LedgerImportForm } from "@/components/app/ledger-import-form";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, sp } = await loadClientPage(params, searchParams);
  const banks = client.entities.flatMap((e) => e.bankAccounts.map((b) => ({ id: b.id, label: b.label, entity: e.name, bank: b.bank, number: b.number })));
  const imports = await prisma.statementImport.findMany({
    where: { bankAccountId: { in: banks.map((b) => b.id) } },
    include: { bankAccount: { include: { entity: true } } },
    orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
  const ledgerImports = await prisma.ledgerImport.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 30, include: { _count: { select: { entries: true } } } });
  const hasBanks = banks.length > 0;
  const tab = !hasBanks || sp.tab === "ledger" ? "ledger" : "statement";

  let sample: { bankAccountId: string; fileName: string } | undefined;
  if (process.env.DEMO_MODE === "true") {
    const f = await liveUploadFile();
    const acct = banks.find((b) => f.fileName.includes(b.number.slice(-4)) && f.fileName.startsWith(b.bank));
    const already = acct && imports.some((i) => i.bankAccountId === acct.id && i.fileName === f.fileName);
    if (acct && !already) sample = { bankAccountId: acct.id, fileName: f.fileName };
  }

  const ledger = (
    <div className="space-y-6">
      <LedgerImportForm clientId={client.id} entities={client.entities.map((e) => ({ id: e.id, name: e.name, currency: e.functionalCurrency }))} />
      <Card>
        <CardHeader>
          <CardTitle>Riwayat impor buku besar & neraca</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {ledgerImports.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">Belum ada buku besar atau neraca yang diimpor untuk klien ini.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">File · sheet</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="hidden md:table-cell">Periode</TableHead>
                  <TableHead className="text-right">Baris</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerImports.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-6">
                      <Link href={`/clients/${client.id}/import/ledger/${i.id}`} className="hover:text-primary">
                        <span className="font-mono text-xs">{i.fileName}</span> <span className="text-muted-foreground">· {i.sheetName}</span>
                      </Link>
                    </TableCell>
                    <TableCell>{i.mode === "NERACA" ? "Neraca" : "Buku besar"}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(i.periodStart)}{+i.periodEnd !== +i.periodStart ? ` – ${formatDate(i.periodEnd)}` : ""}</TableCell>
                    <TableCell className="num text-right">{i.rowCount}</TableCell>
                    <TableCell>
                      <StatusPill status={i.status === "POSTED" ? "PASS" : "REVIEW"} label={i.status === "POSTED" ? `Tercatat · ${i._count.entries} jurnal` : "Draf"} />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Link href={`/clients/${client.id}/import/ledger/${i.id}`} aria-label={`Buka ${i.fileName}`} className="text-muted-foreground hover:text-primary">
                        <ChevronRight className="size-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={hasBanks ? "Impor Mutasi" : "Impor Buku Besar"}
        description={`${client.name} · ${hasBanks ? "rekening koran, buku besar atau neraca" : "buku besar atau neraca dari sistem lama"}; setiap angka tetap bisa ditelusuri ke baris file aslinya`}
      />
      <NextStep>{hasBanks ? "Pilih rekening, unggah rekening koran, lalu periksa hasilnya di Review transaksi." : "Unggah buku besar atau neraca, periksa file, petakan akun, lalu catat."}</NextStep>
      {!hasBanks ? (
        ledger
      ) : (
        <Tabs defaultValue={tab}>
          <TabsList>
            <TabsTrigger value="statement">Rekening koran</TabsTrigger>
            <TabsTrigger value="ledger">Buku besar / neraca</TabsTrigger>
          </TabsList>
          <TabsContent value="statement" className="space-y-6">
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
          </TabsContent>
          <TabsContent value="ledger">{ledger}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}

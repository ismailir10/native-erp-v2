import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import type { SearchParams } from "@/lib/scope";
import { rateNeeds } from "@/lib/fx/rates";
import { type CurrencyCode } from "@/lib/fx/currency";
import { formatDate } from "@/lib/format";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { RateForm } from "@/components/app/rate-form";
import { RateList } from "@/components/app/rate-list";
import { StatusPill } from "@/components/app/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function RatesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period } = await loadClientPage(params, searchParams);
  const [rates, needs] = await Promise.all([
    prisma.exchangeRate.findMany({ where: { firmId: client.firmId }, orderBy: [{ currency: "asc" }, { date: "desc" }, { kind: "asc" }] }),
    rateNeeds(prisma, client.id, period.end),
  ]);
  const foreign = client.entities.filter((e) => e.functionalCurrency !== "IDR");
  const missing = needs.filter((n) => !n.present);
  const defaultCurrency = (foreign[0]?.functionalCurrency ?? "USD") as CurrencyCode;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kurs"
        description="Kurs dipakai untuk mengonversi baris valas saat impor dan menjabarkan entitas non-Rupiah ke Gabungan Grup. Diisi manual atau diambil dari file impor, tidak diambil otomatis dari internet."
      />
      {foreign.length === 0 ? (
        <NextStep tone="done">Semua entitas memakai Rupiah. Kurs hanya perlu diisi untuk impor yang mengonversi baris valas.</NextStep>
      ) : missing.length ? (
        <NextStep>
          Isi {missing.length} kurs {foreign.map((e) => e.functionalCurrency).filter((c, i, a) => a.indexOf(c) === i).join(", ")}→IDR di bawah agar Gabungan Grup bisa dijabarkan.
        </NextStep>
      ) : (
        <NextStep tone="done">Kurs untuk menjabarkan {foreign.map((e) => e.shortName).join(", ")} ke Rupiah sudah lengkap.</NextStep>
      )}

      {needs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Kurs yang dibutuhkan Gabungan Grup</CardTitle>
            <CardDescription>
              Aset & liabilitas memakai kurs penutup di bulan laporan, laba rugi memakai kurs rata-rata tahun itu, ekuitas memakai kurs historis. Selisihnya tampil sebagai
              “Selisih penjabaran mata uang asing”.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Kebutuhan</TableHead>
                  <TableHead>Pasangan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="pr-6 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...needs].sort((a, b) => Number(a.present) - Number(b.present)).map((n) => (
                  <TableRow key={`${n.currency}-${n.kind}-${+n.date}`}>
                    <TableCell className="pl-6">{n.label}</TableCell>
                    <TableCell>{n.currency} → {n.quote}</TableCell>
                    <TableCell>{formatDate(n.date)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <StatusPill status={n.present ? "PASS" : "REVIEW"} label={n.present ? "Ada" : "Belum ada"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tambah atau ubah kurs</CardTitle>
          <CardDescription>1 unit mata uang asal = kurs × mata uang tujuan. Tanggal dan jenis yang sama menimpa kurs lama. Kurs manual tidak ditimpa oleh file impor.</CardDescription>
        </CardHeader>
        <CardContent>
          <RateForm
            clientId={client.id}
            defaultCurrency={defaultCurrency}
            missing={missing.map((m) => ({ currency: m.currency, quote: m.quote, kind: m.kind, date: m.date.toISOString().slice(0, 10), label: `${m.label} · ${formatDate(m.date)}` }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar kurs</CardTitle>
          <CardDescription>Berlaku untuk semua klien kantor ini.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <RateList clientId={client.id} rates={rates} />
        </CardContent>
      </Card>
    </div>
  );
}

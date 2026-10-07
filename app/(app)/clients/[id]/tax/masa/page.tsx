import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/lib/db";
import { loadClientPage } from "@/lib/client-page";
import { type SearchParams, withParams } from "@/lib/scope";
import { formatDate, formatPeriod, periodBounds } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { packApplies } from "@/lib/tax/pack";
import { masaReport, ppnLine, previousStateLabel, rowNotes, terNote, terRow, withholdingLabel, type MasaRow, type WithholdingLine } from "@/lib/tax/masa-report";
import { NextStep, PageHeader } from "@/components/app/page-header";
import { ScopeBar } from "@/components/app/scope-bar";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Pajak Masa" };

export default async function TaxMasaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { client, period, scope, periodOptions, entityOptions, base } = await loadClientPage(params, searchParams, { defaultCombined: false });
  const entity = client.entities.find((e) => e.id === scope.entityIds[0])!;
  const label = formatPeriod(period.year, period.month);
  const companies = entityOptions.filter((o) => { const e = client.entities.find((x) => x.id === o.value); return e && packApplies(e); });
  const header = (
    <PageHeader
      title="Pajak Masa"
      description={`${entity.name} · PPN, PPh 21, PPh 23 dan pemotongan lain masa ${label} (kertas kerja, bukan SPT)`}
      actions={
        <>
          <ScopeBar entities={companies.length ? companies : entityOptions} periods={periodOptions} entity={scope.value} period={period.key} allowCombined={false} />
          {packApplies(entity) && (
            <a href={withParams(`${base}/tax/masa/export`, { period: period.key, entity: entity.id })} className={buttonVariants({ variant: "outline", size: "sm" })} download data-testid="masa-download">
              <Download /> Unduh Excel
            </a>
          )}
        </>
      }
    />
  );
  if (!packApplies(entity)) {
    return (
      <div className="space-y-6">
        {header}
        <NextStep>Pilih badan usaha (PT/CV) dengan pembukuan Rupiah. Pajak masa orang pribadi dan entitas valuta asing belum dihitung di sini.</NextStep>
      </div>
    );
  }
  const report = (await masaReport(prisma, { clientId: client.id, entityId: entity.id, year: period.year, month: period.month }))!;
  const ledger = (code: string) => withParams(`${base}/ledger/${code}`, { entity: entity.id, period: period.key });
  // Problems first (ui-rules 10).
  const rows = [...report.rows].sort((a, b) => (a.status === b.status ? 0 : a.status === "REVIEW" ? -1 : 1));
  const firstProblem = rows.find((r) => r.status === "REVIEW");
  const terReview = report.ter.state === "CHECKED" && report.ter.status === "REVIEW";
  const reviewInWht = [...report.withheldByUs, ...report.withheldFromUs].filter((w) => w.inReview).length;
  // Lines still in Review sit on 1999 without their tax: the masa's PPN and PPh are not final until they are decided.
  const { start, end } = periodBounds(period.year, period.month);
  const pending = await prisma.bankTransaction.count({ where: { entityId: entity.id, status: "NEEDS_REVIEW", date: { gte: start, lte: end } } });

  return (
    <div className="space-y-6">
      {header}
      {firstProblem ? (
        <NextStep>{firstProblem.label}: {rowNotes(firstProblem)[0]}</NextStep>
      ) : pending ? (
        <NextStep href={withParams(`${base}/review`, { period: period.key })} cta="Buka Review">
          {pending} mutasi {entity.shortName} {label} masih di Review, jadi pajak masa ini belum final. Selesaikan Review sebelum lapor di Coretax.
        </NextStep>
      ) : terReview ? (
        <NextStep>{terNote(report.ter)}</NextStep>
      ) : (
        <NextStep tone="done">Pajak masa {label} lolos semua pemeriksaan. Unduh kertas kerjanya untuk lapor di Coretax.</NextStep>
      )}

      <Card data-testid="masa-taxes">
        <CardHeader>
          <CardTitle>Setoran per jenis pajak</CardTitle>
          <CardDescription>
            Terutang masa ini dari buku besar; masa lalu dinilai dari setoran bank yang diklasifikasikan ke akun pajaknya sampai jatuh tempo (PPh tanggal 15, PPN akhir bulan berikutnya).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="eyebrow">Pajak</TableHead>
                <TableHead className="eyebrow text-right">Terutang masa ini</TableHead>
                <TableHead className="eyebrow hidden text-right md:table-cell">Jatuh tempo</TableHead>
                <TableHead className="eyebrow hidden text-right sm:table-cell">Masa lalu</TableHead>
                <TableHead className="eyebrow hidden text-right md:table-cell">Saldo akun</TableHead>
                <TableHead className="eyebrow hidden text-right sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => <TaxRow key={r.key} r={r} href={ledger(r.code)} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="masa-withholding">
        <CardHeader>
          <CardTitle>Bukti potong (Unifikasi)</CardTitle>
          <CardDescription>
            Dari mutasi bank dengan potongan PPh 22, 23 atau 4(2) masa ini. Bruto = yang dibayar atau diterima + yang dipotong. PPh 21 tidak masuk
            Unifikasi: bukti potongnya dibuat per penerima di e-Bupot 21/26.{reviewInWht ? ` ${reviewInWht} baris belum direview.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <WithholdingTable title="Dipotong oleh perusahaan: buat bukti potongnya di Coretax" lines={report.withheldByUs} empty="Tidak ada pemotongan oleh perusahaan masa ini." />
          <WithholdingTable title="Dipotong oleh pelanggan: minta bukti potongnya" lines={report.withheldFromUs} empty="Tidak ada pemotongan oleh pelanggan masa ini." />
        </CardContent>
      </Card>

      <Card data-testid="masa-ter">
        <CardHeader>
          <CardTitle>PPh 21 dengan TER</CardTitle>
          <CardDescription>PP 58/2023, Januari–November. Estimasi dari upah di sensus karyawan dan status PTKP.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-start gap-2">
            {report.ter.state === "CHECKED" && <StatusPill status={report.ter.status} />}
            <p className="min-w-0 flex-1">{terNote(report.ter)}</p>
            {report.ter.state !== "CHECKED" && report.ter.state !== "DECEMBER" && (
              <Link href={withParams(`${base}/benefits`, { entity: entity.id, period: period.key })} className="text-primary underline-offset-2 hover:underline">Buka Imbalan Kerja</Link>
            )}
          </div>
          {report.ter.state === "CHECKED" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="eyebrow">Nama</TableHead>
                  <TableHead className="eyebrow">PTKP</TableHead>
                  <TableHead className="eyebrow hidden text-right sm:table-cell">Upah</TableHead>
                  <TableHead className="eyebrow text-right">Tarif</TableHead>
                  <TableHead className="eyebrow text-right">PPh 21</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.ter.employees.map(terRow).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.name}</TableCell>
                    <TableCell>{e.statusLabel} · {e.category}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell"><Money value={e.wage} /></TableCell>
                    <TableCell className="num text-right">{e.rateLabel}</TableCell>
                    <TableCell className="text-right"><Money value={e.tax} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Estimasi TER</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell />
                  <TableCell className="text-right"><Money value={report.ter.estimate} strong /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2}><Link href={ledger("2140")} className="hover:text-primary">Terutang di buku besar (2140)</Link></TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell />
                  <TableCell className="text-right"><Money value={report.ter.booked} strong /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TaxRow({ r, href }: { r: MasaRow; href: string }) {
  const notes = rowNotes(r);
  const p = r.previous;
  const paid = p.paid.reduce((t, x) => t + x.amount, 0n);
  const late = p.late.reduce((t, x) => t + x.amount, 0n);
  return (
    <>
      <TableRow data-testid={`masa-row-${r.key}`}>
        <TableCell className="font-medium">
          <Link href={href} className="hover:text-primary">{r.label}</Link>
          <span className="ml-1 text-xs text-muted-foreground">{r.code}</span>
          {/* Phones: the status sits under the name (the Status column is hidden below sm). */}
          <div className="mt-1 sm:hidden"><StatusPill status={r.status} /></div>
        </TableCell>
        <TableCell className="text-right"><Link href={href} className="hover:text-primary"><Money value={r.owed} /></Link></TableCell>
        <TableCell className="num hidden text-right md:table-cell">{formatDate(r.due)}</TableCell>
        <TableCell className="hidden text-right sm:table-cell">
          <Money value={p.owed} />
          <div className="text-xs text-muted-foreground">
            {formatPeriod(p.masa.year, p.masa.month)} · {r.netPayroll ? "disetor tanpa terutang" : previousStateLabel(p.state)}
          </div>
          {paid + late > 0n && paid + late !== p.owed && <div className="num text-xs text-muted-foreground">disetor {formatRupiah(paid + late, { bare: true })}</div>}
        </TableCell>
        <TableCell className="hidden text-right md:table-cell"><Link href={href} className="hover:text-primary"><Money value={r.balance} /></Link></TableCell>
        <TableCell className="hidden text-right sm:table-cell"><StatusPill status={r.status} /></TableCell>
      </TableRow>
      {(notes.length > 0 || r.ppn) && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="pt-0 text-xs whitespace-normal text-muted-foreground">
            {r.ppn && <div>{ppnLine(r.ppn)}</div>}
            {notes.map((x) => <div key={x}>{x}</div>)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function WithholdingTable({ title, lines, empty }: { title: string; lines: WithholdingLine[]; empty: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="eyebrow">Tanggal</TableHead>
              <TableHead className="eyebrow">Lawan transaksi</TableHead>
              <TableHead className="eyebrow">Jenis</TableHead>
              <TableHead className="eyebrow hidden text-right sm:table-cell">Bruto</TableHead>
              <TableHead className="eyebrow text-right">Dipotong</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="num whitespace-nowrap">{formatDate(w.date)}</TableCell>
                <TableCell className="whitespace-normal">
                  <div>{w.contact?.name ?? <span className="text-muted-foreground">Belum ditautkan ke kontak</span>}{w.contact?.npwp ? <span className="num ml-1 text-xs text-muted-foreground">NPWP {w.contact.npwp}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{w.description}{w.inReview ? " · belum direview" : ""}</div>
                </TableCell>
                <TableCell>{withholdingLabel(w.kind)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell"><Money value={w.gross} /></TableCell>
                <TableCell className="text-right"><Money value={w.withheld} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

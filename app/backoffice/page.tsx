import { PageHeader, NextStep } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessStatus } from "@/components/backoffice/access-status";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { listOrganisations } from "@/lib/backoffice/orgs";
import { prisma } from "@/lib/db";
import { formatDateWib } from "@/lib/format";
import Link from "next/link";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrganisationForm } from "@/components/backoffice/org-forms";

export const metadata = { title: "Organisasi" };

const KIND = { KANTOR_AKUNTAN: "Kantor akuntan", PERUSAHAAN: "Perusahaan" } as const;

/** Every organisation on Buku with its access and usage. Counts and dates only, never a client's name, figure or file. */
export default async function OrganisationsPage() {
  await requirePlatformAdmin();
  const rows = await listOrganisations(prisma);
  const ending = rows.filter((r) => !r.suspended && r.access.state === "ACTIVE" && r.access.daysLeft !== null && r.access.daysLeft <= 7).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Organisasi" description="Kantor akuntan dan perusahaan yang memakai Buku, beserta masa aksesnya." />
      <NextStep>{ending ? `${ending} organisasi berakhir dalam 7 hari. Perpanjang atau biarkan menjadi hanya baca.` : rows.length ? "Tidak ada akses yang berakhir dalam 7 hari." : "Belum ada organisasi."}</NextStep>
      <Card>
        <CardHeader><CardTitle>Buat organisasi</CardTitle><CardDescription>Untuk kantor akuntan atau perusahaan yang dihubungi langsung.</CardDescription></CardHeader>
        <CardContent><CreateOrganisationForm /></CardContent>
      </Card>
      <Card className="p-0">
        <Table data-testid="organisations">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Organisasi</TableHead>
              <TableHead className="hidden sm:table-cell">Akses</TableHead>
              <TableHead className="text-right">Anggota</TableHead>
              <TableHead className="hidden text-right md:table-cell">Klien</TableHead>
              <TableHead className="hidden text-right md:table-cell">Entitas</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Token AI bulan ini</TableHead>
              <TableHead className="hidden pr-6 lg:table-cell">Aktivitas terakhir</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid="organisation-row">
                <TableCell className="pl-6">
                  <Link href={`/backoffice/orgs/${r.id}`} className="drill font-medium">{r.name}</Link>
                  <p className="text-xs text-muted-foreground">{KIND[r.kind]}{r.ownerEmail ? ` · ${r.ownerEmail}` : ""}</p>
                  <div className="mt-1 sm:hidden"><AccessStatus access={r.access} suspended={r.suspended} /></div>
                </TableCell>
                <TableCell className="hidden sm:table-cell"><AccessStatus access={r.access} suspended={r.suspended} /></TableCell>
                <TableCell className="num text-right">{r.seatLimit === null ? r.members : `${r.members}/${r.seatLimit}`}</TableCell>
                <TableCell className="num hidden text-right md:table-cell">{r.clients}</TableCell>
                <TableCell className="num hidden text-right md:table-cell">{r.entities}</TableCell>
                <TableCell className="num hidden text-right lg:table-cell">{r.aiTokens ? r.aiTokens.toLocaleString("id-ID") : "–"}</TableCell>
                <TableCell className="hidden pr-6 text-sm lg:table-cell">{r.lastActivity ? formatDateWib(r.lastActivity) : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

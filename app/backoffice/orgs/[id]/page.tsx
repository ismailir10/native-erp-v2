import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessStatus } from "@/components/backoffice/access-status";
import { GrantForm, GrantRowActions, InviteOwnerForm, LimitsForm, SuspendForm } from "@/components/backoffice/org-forms";
import { SupportForm } from "@/components/backoffice/support-form";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { organisationDetail } from "@/lib/backoffice/orgs";
import { prisma } from "@/lib/db";
import { formatDateTime, formatDateWib } from "@/lib/format";
import { aiConfig } from "@/lib/ai/provider";
import { ROLE_LABEL } from "@/lib/auth/permissions";

export const metadata = { title: "Organisasi" };

const KIND = { KANTOR_AKUNTAN: "Kantor akuntan", PERUSAHAAN: "Perusahaan" } as const;
const GRANT = { TRIAL: "Uji coba", PAID: "Berbayar", COMP: "Gratis" } as const;
const wibDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Access, people, limits and Buku's own log for one organisation (ADR 0017 §2–3). Counts and names of people only, never books. */
export default async function OrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const detail = await organisationDetail(prisma, id);
  if (!detail) notFound();
  const { firm, access, events, supportSessions, aiUse } = detail;
  const now = new Date();
  const status = (g: (typeof firm.grants)[number]) => g.revokedAt ? "Dicabut" : g.startsAt > now ? "Akan datang" : g.endsAt && g.endsAt <= now ? "Berakhir" : "Berjalan";
  return (
    <div className="space-y-6">
      <Link href="/backoffice" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" />Organisasi</Link>
      <PageHeader title={firm.name} description={`${KIND[firm.kind]} · dibuat ${formatDateWib(firm.createdAt)} · ${firm._count.clients} klien · AI bulan ini ${aiUse.spent.toLocaleString("id-ID")} dari ${aiUse.limit.toLocaleString("id-ID")} token`} actions={<AccessStatus access={access} suspended={Boolean(firm.suspendedAt)} />} />
      {firm.suspendedAt ? <NextStep>Organisasi ini ditangguhkan sejak {formatDateWib(firm.suspendedAt)}: tidak ada yang bisa masuk. Pulihkan di bawah bila sudah selesai.</NextStep>
        : access.state === "NONE" ? <NextStep>Belum ada akses yang berjalan. Beri akses agar anggotanya bisa masuk.</NextStep>
        : access.state === "READ_ONLY" ? <NextStep>Akses berakhir; ruang kerja hanya bisa dibaca. Perpanjang atau beri akses baru.</NextStep>
        : !firm.members.length ? <NextStep>Undang pemilik organisasi agar bisa masuk dan mengundang timnya.</NextStep>
        : <NextStep tone="done">Akses berjalan{access.endsAt ? ` sampai ${formatDateWib(access.endsAt)}` : " tanpa batas"}.</NextStep>}

      <Card>
        <CardHeader><CardTitle>Akses</CardTitle><CardDescription>Akses berakhir pukul 23.59 WIB pada tanggal berakhirnya. Sesudah itu ruang kerja hanya bisa dibaca; data tidak dihapus.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {firm.grants.length > 0 && (
            <Table data-testid="grants">
              <TableHeader><TableRow><TableHead>Jenis</TableHead><TableHead>Mulai</TableHead><TableHead>Berakhir</TableHead><TableHead className="hidden md:table-cell">Catatan</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {firm.grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>{GRANT[g.kind]}</TableCell>
                    <TableCell className="text-sm">{formatDateWib(g.startsAt)}</TableCell>
                    <TableCell className="text-sm">{g.endsAt ? formatDateWib(g.endsAt) : "Tanpa batas"}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{g.note ?? "–"}{g.grantedBy && ` · ${g.grantedBy.name}`}</TableCell>
                    <TableCell className="text-sm">{status(g)}</TableCell>
                    <TableCell>{!g.revokedAt && <GrantRowActions firmId={firm.id} grantId={g.id} endsOn={g.endsAt ? wibDate(g.endsAt) : ""} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <GrantForm firmId={firm.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Anggota</CardTitle><CardDescription>Undang pemilik di sini; anggota lain diundang oleh organisasi sendiri di Pengaturan → Tim.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {firm.members.length > 0 && (
            <ul className="divide-y text-sm" data-testid="org-members">
              {firm.members.map((m) => <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{m.name} · {m.email}</span><span className="text-muted-foreground">{ROLE_LABEL[m.role]}{m.disabled ? " · nonaktif" : ""}</span></li>)}
            </ul>
          )}
          <InviteOwnerForm firmId={firm.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Batas</CardTitle><CardDescription>Kosongkan untuk tanpa batas anggota, atau untuk batas token AI bawaan.</CardDescription></CardHeader>
        <CardContent><LimitsForm firmId={firm.id} seatLimit={firm.seatLimit} aiBudget={firm.aiMonthlyTokenBudget} defaultBudget={aiConfig().monthlyTokenBudget} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Penangguhan</CardTitle><CardDescription>Menutup ruang kerja seketika, apa pun aksesnya. Untuk penyalahgunaan atau tagihan; data tetap tersimpan.</CardDescription></CardHeader>
        <CardContent><SuspendForm firmId={firm.id} suspended={Boolean(firm.suspendedAt)} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dukungan</CardTitle><CardDescription>Buka ruang kerja ini sebagai salah satu anggotanya untuk memeriksa masalah: hanya baca, paling lama 60 menit, tanpa pemberitahuan ke organisasi. Setiap halaman yang dibuka dicatat di sini.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {admin.aal === "aal2"
            ? <SupportForm firmId={firm.id} members={firm.members.map((m) => ({ id: m.id, label: `${m.name} · ${ROLE_LABEL[m.role]}${m.disabled ? " · nonaktif" : ""}` }))} />
            : <p className="text-sm">Aktifkan verifikasi dua langkah di <Link href="/backoffice/keamanan" className="drill">Keamanan</Link> untuk membuka ruang kerja.</p>}
          {supportSessions.length > 0 && (
            <ul className="divide-y text-sm" data-testid="support-sessions">
              {supportSessions.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{s.admin.name} sebagai {s.asMember.name} · {s.reason}</span><span className="text-muted-foreground">{formatDateTime(s.startedAt)} · {s._count.views} halaman · {s.endedAt ? "selesai" : s.expiresAt > now ? "berjalan" : "habis waktu"}</span></li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Riwayat Buku</CardTitle><CardDescription>Catatan tindakan admin Buku pada organisasi ini. Tidak terlihat oleh organisasi.</CardDescription></CardHeader>
        <CardContent>
          {events.length ? (
            <ul className="divide-y text-sm" data-testid="platform-events">
              {events.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{e.summary}</span><span className="text-muted-foreground">{formatDateTime(e.createdAt)} · {e.admin?.name ?? "CLI"}</span></li>)}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Belum ada catatan.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

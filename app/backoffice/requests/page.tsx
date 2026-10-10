import Link from "next/link";
import { PageHeader, NextStep } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestActions } from "@/components/backoffice/request-actions";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listSignups } from "@/lib/signup";

export const metadata = { title: "Permintaan" };
const KIND = { KANTOR_AKUNTAN: "Kantor akuntan", PERUSAHAAN: "Perusahaan" } as const;

/** Trial requests from /daftar: pending first, each approved (organisation + trial + owner invitation) or rejected with a reason. */
export default async function RequestsPage() {
  await requirePlatformAdmin();
  const rows = await listSignups(prisma);
  const open = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter((r) => r.status !== "PENDING");
  return (
    <div className="space-y-6">
      <PageHeader title="Permintaan uji coba" description="Dari formulir publik /daftar. Menyetujui membuat organisasinya, masa uji coba dan undangan untuk pemiliknya." />
      <NextStep>{open.length ? `${open.length} permintaan menunggu. Setujui dengan tanggal akhir uji coba, atau tolak dengan alasan.` : "Tidak ada permintaan yang menunggu."}</NextStep>
      {open.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Menunggu</CardTitle></CardHeader>
          <CardContent className="divide-y p-0" data-testid="requests-pending">
            {open.map((r) => (
              <div key={r.id} className="space-y-3 px-6 py-4" data-testid="request-row">
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{r.orgName} <span className="font-normal text-muted-foreground">· {KIND[r.orgKind]}</span></p>
                    <p className="text-sm text-muted-foreground">{r.name} · {r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                    {r.note && <p className="mt-1 text-sm">{r.note}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
                </div>
                <RequestActions requestId={r.id} email={r.email} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {decided.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Sudah diputuskan</CardTitle><CardDescription>200 terakhir.</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" data-testid="requests-decided">
              {decided.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{r.firmId ? <Link href={`/backoffice/orgs/${r.firmId}`} className="drill">{r.orgName}</Link> : r.orgName} · {r.email}</span>
                  <span className="text-muted-foreground">{r.status === "APPROVED" ? "Disetujui" : `Ditolak · ${r.reason ?? ""}`} · {r.decidedAt ? formatDateTime(r.decidedAt) : ""}{r.decidedBy ? ` · ${r.decidedBy.name}` : ""}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

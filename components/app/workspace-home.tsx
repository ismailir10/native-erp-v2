import { PageHeader, NextStep } from "@/components/app/page-header";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { WorkspaceAsk } from "@/components/app/workspace-ask";
import { WorkspaceTasks, WorkspaceClose, WorkspaceFinancials } from "@/components/app/workspace-overview";
import { loadWorkspace, WorkspaceScopeError, type WorkspaceSearchParams } from "@/components/app/workspace-page";
import { redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { companyClient, isCompany } from "@/lib/org";

export default async function WorkspaceHome({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  // A company's home is its own books (ADR 0017 §1); there is no list of clients to choose from.
  const { firm } = await requireWorkspaceSession();
  if (isCompany(firm)) {
    const books = await companyClient(prisma, firm);
    redirect(books ? `/clients/${books.id}` : "/clients/new");
  }
  const data = await loadWorkspace(searchParams);
  if ("error" in data) return <WorkspaceScopeError message={data.error} />;
  const first = data.tasks[0];
  const expanded = (await searchParams).tugas === "semua";
  const header = <PageHeader title="Beranda" description="Periksa yang perlu dikerjakan, lalu telusuri angkanya." actions={<WorkspaceScopeBar scope={data.scope} />} />;
  // A firm with no client has one thing to do; the question box comes after there are books to ask about.
  if (!data.scope.clients.length) {
    return <div className="space-y-6">{header}<NextStep href="/clients/new" cta="Tambah klien">Belum ada klien. Tambahkan klien pertama beserta perusahaannya, lalu unggah rekening koran-nya.</NextStep></div>;
  }
  return (
    <div className="space-y-6">
      {header}
      {first ? (
        <NextStep href={first.href} cta="Kerjakan">{first.title}.{data.tasks.length > 1 && ` ${data.tasks.length - 1} pekerjaan lain menunggu.`}</NextStep>
      ) : (
        <NextStep tone="done">{`Semua klien dalam cakupan ini sudah tutup buku ${data.scope.periodLabel}.`}</NextStep>
      )}
      <WorkspaceTasks data={data} limit={3} expanded={expanded} afterFirst />
      <WorkspaceAsk scope={data.scope} />
      <WorkspaceClose data={data} />
      <WorkspaceFinancials data={data} />
    </div>
  );
}

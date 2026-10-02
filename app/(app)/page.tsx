import { PageHeader, NextStep } from "@/components/app/page-header";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { WorkspaceAsk } from "@/components/app/workspace-ask";
import { WorkspaceTasks, WorkspaceClose, WorkspaceFinancials } from "@/components/app/workspace-overview";
import { loadWorkspace, WorkspaceScopeError, type WorkspaceSearchParams } from "@/components/app/workspace-page";

export const metadata = { title: "Beranda" };

export default async function HomePage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
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
        <NextStep href={first.href} cta="Kerjakan">{data.tasks.length} pekerjaan menunggu. Pertama: {first.title}.</NextStep>
      ) : (
        <NextStep tone="done">{`Semua klien dalam cakupan ini sudah tutup buku ${data.scope.periodLabel}.`}</NextStep>
      )}
      <WorkspaceAsk scope={data.scope} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><WorkspaceTasks data={data} limit={3} expanded={expanded} /><WorkspaceClose data={data} /></div>
      <WorkspaceFinancials data={data} />
    </div>
  );
}

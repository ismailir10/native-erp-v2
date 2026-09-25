import { PageHeader, NextStep } from "@/components/app/page-header";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { WorkspaceAsk } from "@/components/app/workspace-ask";
import { WorkspaceTasks, WorkspaceClose, WorkspaceFinancials } from "@/components/app/workspace-overview";
import { loadWorkspace, WorkspaceScopeError, type WorkspaceSearchParams } from "@/components/app/workspace-page";

export default async function HomePage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  const data = await loadWorkspace(searchParams);
  if ("error" in data) return <WorkspaceScopeError message={data.error} />;
  return <div className="space-y-6"><PageHeader title="Beranda" description="Periksa yang perlu dikerjakan, lalu telusuri angkanya." /><WorkspaceScopeBar scope={data.scope} /><WorkspaceAsk scope={data.scope} />{!data.scope.clients.length ? <NextStep href="/clients/new" cta="Tambah klien">Belum ada klien. Tambahkan klien pertama beserta perusahaannya.</NextStep> : <><NextStep tone={data.tasks.length ? "info" : "done"}>{data.tasks.length ? `${data.tasks.length} pekerjaan menunggu. Mulai dari daftar di bawah.` : `Semua klien dalam cakupan ini sudah tutup buku ${data.scope.periodLabel}.`}</NextStep><div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><WorkspaceTasks data={data} limit={3} /><WorkspaceClose data={data} /></div><WorkspaceFinancials data={data} /></>}</div>;
}

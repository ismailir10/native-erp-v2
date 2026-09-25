import { PageHeader, NextStep } from "@/components/app/page-header";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { WorkspaceTasks, WorkspaceClose } from "@/components/app/workspace-overview";
import { loadWorkspace, WorkspaceScopeError, type WorkspaceSearchParams } from "@/components/app/workspace-page";

export default async function WorkPage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  const data = await loadWorkspace(searchParams);
  if ("error" in data) return <WorkspaceScopeError message={data.error} />;
  const first = data.tasks[0];
  return <div className="space-y-6"><PageHeader title="Pekerjaan" description="Selesaikan review transaksi dan pemeriksaan akhir sebelum tutup buku." actions={<WorkspaceScopeBar scope={data.scope} />} />{first ? <NextStep href={first.href} cta={first.title}>{first.detail}</NextStep> : <NextStep tone={data.clients.length ? "done" : "info"} href={!data.clients.length ? "/clients/new" : undefined} cta="Tambah klien">{data.clients.length ? "Tidak ada pekerjaan tertunda pada cakupan ini." : "Belum ada klien. Tambahkan klien untuk mulai menyiapkan buku."}</NextStep>}<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"><WorkspaceTasks data={data} /><WorkspaceClose data={data} /></div></div>;
}

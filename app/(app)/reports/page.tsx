import { PageHeader, NextStep } from "@/components/app/page-header";
import { WorkspaceScopeBar } from "@/components/app/workspace-scope";
import { WorkspaceFinancials } from "@/components/app/workspace-overview";
import { loadWorkspace, WorkspaceScopeError, type WorkspaceSearchParams } from "@/components/app/workspace-page";

export default async function ReportsPage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  const data = await loadWorkspace(searchParams);
  if ("error" in data) return <WorkspaceScopeError message={data.error} />;
  return <div className="space-y-6"><PageHeader title="Laporan" description="Laporan keuangan dari jurnal yang sudah dibukukan." actions={<WorkspaceScopeBar scope={data.scope} />} /><NextStep>Pilih angka untuk membuka laporan perusahaan dan menelusuri jurnal sumbernya.</NextStep><WorkspaceFinancials data={data} /></div>;
}

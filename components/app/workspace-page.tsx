import { getCurrentFirm } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getWorkspaceOverview, WorkspaceInputError } from "@/lib/workspace";
import { NextStep, PageHeader } from "@/components/app/page-header";

export type WorkspaceSearchParams = Promise<Record<string, string | string[] | undefined>>;
export async function loadWorkspace(searchParams: WorkspaceSearchParams) {
  const [firm, params] = await Promise.all([getCurrentFirm(), searchParams]);
  try {
    return await getWorkspaceOverview(prisma, firm.id, { scope: typeof params.scope === "string" ? params.scope : undefined, period: typeof params.period === "string" ? params.period : undefined });
  } catch (error) {
    if (error instanceof WorkspaceInputError) return { error: error.message };
    throw error;
  }
}
export function WorkspaceScopeError({ message }: { message: string }) {
  return <div className="space-y-6"><PageHeader title="Cakupan tidak tersedia" /><NextStep href="/?scope=all" cta="Kembali ke semua klien">{message} Pilih cakupan dan periode yang tersedia.</NextStep></div>;
}

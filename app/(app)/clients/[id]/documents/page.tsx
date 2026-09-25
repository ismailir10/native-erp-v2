import { redirect } from "next/navigation";
import { getClientForFirm } from "@/lib/tenant";
import type { SearchParams } from "@/lib/scope";

export default async function ClientDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const client = await getClientForFirm(id);
  const input = await searchParams;
  const entity = typeof input.entity === "string" && client.entities.some(e => e.id === input.entity) ? input.entity : undefined;
  const query = new URLSearchParams({ scope: entity ? `entity:${entity}` : `client:${id}` });
  if (typeof input.period === "string") query.set("period", input.period);
  redirect(`/documents?${query}`);
}

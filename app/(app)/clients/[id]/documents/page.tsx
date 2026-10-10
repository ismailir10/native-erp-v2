import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { findClientForMember } from "@/lib/tenant";
import type { SearchParams } from "@/lib/scope";

export default async function ClientDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const client = (await findClientForMember(id)) ?? notFound();
  const input = await searchParams;
  const entity = typeof input.entity === "string" && client.entities.some(e => e.id === input.entity) ? input.entity : undefined;
  const query = new URLSearchParams({ scope: entity ? `entity:${entity}` : `client:${id}` });
  if (typeof input.period === "string") query.set("period", input.period);
  redirect(`/documents?${query}`);
}

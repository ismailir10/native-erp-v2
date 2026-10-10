import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getWorkspaceSession } from "@/lib/auth/session";
import { getPlatformAdmin } from "@/lib/auth/platform";
import { PublicLanding } from "@/components/app/public-landing";
import WorkspaceHome from "@/components/app/workspace-home";
import type { WorkspaceSearchParams } from "@/components/app/workspace-page";
import AppLayout from "./(app)/layout";
import AppTemplate from "./(app)/template";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  if (await getWorkspaceSession()) return { title: "Beranda" };
  const title = "Dari rekening koran ke laporan keuangan";
  const description = "Buku membantu kantor akuntan dan perusahaan meninjau pembukuan, menelusuri angka ke sumbernya, dan menutup buku setelah diperiksa.";
  return {
    title: { absolute: `${title} · Buku` },
    description,
    alternates: { canonical: "/" },
    openGraph: { title: `${title} · Buku`, description, url: "/", siteName: "Buku", locale: "id_ID", type: "website" },
    twitter: { card: "summary_large_image", title: `${title} · Buku`, description },
  };
}

export default async function HomePage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  const session = await getWorkspaceSession();
  // A live, verified support session keeps the selected member's workspace.
  if (!session?.support && await getPlatformAdmin()) redirect("/backoffice");
  if (!session) return <PublicLanding />;
  return <AppLayout><AppTemplate><WorkspaceHome searchParams={searchParams} /></AppTemplate></AppLayout>;
}

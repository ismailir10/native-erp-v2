import { redirect } from "next/navigation";
import { getWorkspaceSession } from "@/lib/auth/session";
import { signOutAction } from "@/app/login/actions";
import { AuthShell } from "@/app/login/shell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Akses ditutup" };
export const dynamic = "force-dynamic";

/** Where a member lands when their organisation has no running grant or is suspended (ADR 0017 §3). Shows no data. */
export default async function AccessClosedPage() {
  const session = await getWorkspaceSession();
  if (!session) redirect("/login");
  if (session.access.state !== "NONE") redirect("/");
  return (
    <AuthShell title="Akses ditutup" description={`Ruang kerja ${session.firm.name} sedang tidak aktif. Data Anda tetap tersimpan.`} footer="Untuk membuka kembali atau memperpanjang akses, hubungi tim Buku.">
      <form action={signOutAction}><Button type="submit" variant="outline" className="w-full">Keluar</Button></form>
    </AuthShell>
  );
}

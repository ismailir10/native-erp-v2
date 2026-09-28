import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Client accounts (default when the entity has them) or the Buku chart. State lives in the URL (`?view=buku`). */
export function AccountViewTabs({ clientView, href }: { clientView: boolean; href: (view: "buku" | undefined) => string }) {
  const value = clientView ? "client" : "buku";
  return (
    <Tabs value={value}>
      <TabsList aria-label="Tampilan akun">
        <TabsTrigger value="client" nativeButton={false} render={<Link href={href(undefined)} />}>
          Akun klien
        </TabsTrigger>
        <TabsTrigger value="buku" nativeButton={false} render={<Link href={href("buku")} />}>
          Bagan akun Buku
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

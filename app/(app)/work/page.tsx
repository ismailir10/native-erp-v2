import { redirect } from "next/navigation";
import type { WorkspaceSearchParams } from "@/components/app/workspace-page";

/** Pekerjaan was Beranda's task list on its own page. It lives on Beranda now; old links and bookmarks land on the full list. */
export default async function WorkPage({ searchParams }: { searchParams: WorkspaceSearchParams }) {
  const params = await searchParams;
  const keep = new URLSearchParams();
  for (const key of ["scope", "period"]) if (typeof params[key] === "string") keep.set(key, params[key]);
  keep.set("tugas", "semua");
  redirect(`/?${keep}`);
}

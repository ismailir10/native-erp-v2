"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function signOutAction() {
  await getAuth().api.signOut({ headers: await headers() });
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith("better-auth.") || cookie.name.startsWith("__Secure-better-auth.")) jar.delete(cookie.name);
  }
  redirect("/login");
}

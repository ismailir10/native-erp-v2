"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const Toaster = dynamic(() => import("@/components/ui/sonner").then((module) => module.Toaster), { loading: () => null });

/** Public forms use inline feedback; workspace and administrative actions use notifications. */
export function NotificationHost({ workspace }: { workspace: boolean }) {
  const pathname = usePathname();
  return workspace || pathname.startsWith("/backoffice") ? <Toaster position="bottom-right" closeButton /> : null;
}

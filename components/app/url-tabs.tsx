"use client";

import type { ComponentProps } from "react";
import { Tabs } from "@/components/ui/tabs";

/** Tabs whose selection lives in the URL (`?tab=`) so the view is linkable (ui rule 3), without a server round trip. */
export function UrlTabs({ param = "tab", ...props }: Omit<ComponentProps<typeof Tabs>, "onValueChange"> & { param?: string }) {
  return (
    <Tabs
      {...props}
      onValueChange={(v) => {
        const url = new URL(window.location.href);
        url.searchParams.set(param, String(v));
        window.history.replaceState(null, "", url);
      }}
    />
  );
}

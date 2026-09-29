"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar at the top from the moment an in-app link is followed until the new page is there. A cold server can take seconds
 * (production E2E 2026-09-30); without a sign, the old page looks usable and clicks or typing land on the page being left.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname + url.search === window.location.pathname + window.location.search) return;
      setPending(true);
    };
    // Capture phase: Next's <Link> calls preventDefault() for client navigation, which a bubbling listener would see first.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Any change of URL ends it (the page arrived); clicking the same link again never starts it.
  const [seen, setSeen] = useState(`${pathname}?${search}`);
  if (seen !== `${pathname}?${search}`) {
    setSeen(`${pathname}?${search}`);
    if (pending) setPending(false);
  }

  // A link that ends on the same URL (a redirect back) must not leave the bar running.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 15_000);
    return () => clearTimeout(t);
  }, [pending]);

  if (!pending) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20" data-testid="navigation-progress">
      <div className="h-full w-1/3 animate-pulse bg-primary" />
      <span className="sr-only">Memuat halaman…</span>
    </div>
  );
}

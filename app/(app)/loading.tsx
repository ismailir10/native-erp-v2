import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment a link is followed, while the server prepares the page (a cold start can take seconds). Without it the old
 * page stays on screen and looks usable, so clicks and typing land on the page being left.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-label="Memuat halaman">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <span className="sr-only">Memuat halaman…</span>
    </div>
  );
}

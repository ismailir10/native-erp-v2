import Link from "next/link";
import { cn } from "@/lib/utils";

/** Sections of one page as links (`?tab=`): the choice is in the URL, only the chosen section is rendered, and no client JS is needed. */
export function LinkTabs({ label, items }: { label: string; items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            item.active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

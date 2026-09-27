/** The Buku mark, shared by the sidebar and the login page. */
export function BrandMark({ className = "size-7 text-sm" }: { className?: string }) {
  return <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-sm bg-brand font-bold text-brand-foreground ${className}`}>B</span>;
}

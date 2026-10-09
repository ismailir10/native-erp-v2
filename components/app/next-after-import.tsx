import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** One primary button: the next first-run step. Saldo Awal leads while it's missing (its bank lines are prefilled from this file). */
export function NextAfterImport({ clientId, toReview, openingPending }: { clientId: string; toReview: number; openingPending: boolean }) {
  const review = { href: `/clients/${clientId}/review`, label: `Review ${toReview} transaksi` };
  if (openingPending) {
    return (
      <>
        <Link href={`/clients/${clientId}/opening`} className={buttonVariants({ className: "w-full" })}>Isi saldo awal</Link>
        {toReview > 0 && <Link href={review.href} className={buttonVariants({ variant: "outline", className: "w-full" })}>{review.label}</Link>}
      </>
    );
  }
  return toReview > 0
    ? <Link href={review.href} className={buttonVariants({ className: "w-full" })}>{review.label}</Link>
    : <Link href={`/clients/${clientId}/close`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Buka Tutup Buku</Link>;
}

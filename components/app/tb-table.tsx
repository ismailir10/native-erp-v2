import Link from "next/link";
import { Money } from "@/components/app/money";
import { StatusPill } from "@/components/app/status";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type TbTableRow = {
  key: string;
  code: string;
  name: string;
  href: string;
  /** Secondary line, e.g. the Buku account a client account maps to, or earlier names of the code. */
  sub?: string;
  review?: boolean;
  /** Month movement; null in a translated (mixed-currency) scope, where only closing balances are shown. */
  move: { opening: bigint; debit: bigint; credit: bigint } | null;
  /** Closing balance, debit − credit. */
  net: bigint;
};

/**
 * Neraca Saldo with the month's movement: saldo awal (debit +, credit in parentheses), mutasi debit / kredit, and the
 * closing balance as debit / kredit. Movement columns hide on phones; totals must balance.
 */
export function TbTable({ rows, currency, codeLabel = "Kode" }: { rows: TbTableRow[]; currency: string; codeLabel?: string }) {
  const withMove = rows.some((r) => r.move);
  const dr = rows.reduce((s, r) => s + (r.net > 0n ? r.net : 0n), 0n);
  const cr = rows.reduce((s, r) => s + (r.net < 0n ? -r.net : 0n), 0n);
  const mdr = rows.reduce((s, r) => s + (r.move?.debit ?? 0n), 0n);
  const mcr = rows.reduce((s, r) => s + (r.move?.credit ?? 0n), 0n);
  const opening = rows.reduce((s, r) => s + (r.move?.opening ?? 0n), 0n);
  const ok = dr === cr && mdr === mcr && opening === 0n;
  const hide = "hidden md:table-cell";
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden w-28 pl-6 sm:table-cell">{codeLabel}</TableHead>
          <TableHead className="pl-6 sm:pl-2">Akun</TableHead>
          {withMove && (
            <>
              <TableHead className={`text-right ${hide}`}>Saldo awal</TableHead>
              <TableHead className={`text-right ${hide}`}>Mutasi debit</TableHead>
              <TableHead className={`text-right ${hide}`}>Mutasi kredit</TableHead>
            </>
          )}
          <TableHead className="text-right">Debit</TableHead>
          <TableHead className="pr-6 text-right">Kredit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="num hidden pl-6 text-muted-foreground sm:table-cell">{r.code || "–"}</TableCell>
            <TableCell className="pl-6 whitespace-normal sm:pl-2">
              {r.code && <div className="num text-xs text-muted-foreground sm:hidden">{r.code}</div>}
              <Link className="drill" href={r.href} data-testid="tb-account-link">
                {r.name}
              </Link>
              {r.review && <StatusPill className="ml-2" status="REVIEW" label="Perlu dicek" />}
              {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
            </TableCell>
            {withMove && (
              <>
                <TableCell className={`text-right ${hide}`}>{r.move ? <Money value={r.move.opening} currency={currency} muted /> : null}</TableCell>
                <TableCell className={`text-right ${hide}`}>{r.move?.debit ? <Money value={r.move.debit} currency={currency} /> : null}</TableCell>
                <TableCell className={`text-right ${hide}`}>{r.move?.credit ? <Money value={r.move.credit} currency={currency} /> : null}</TableCell>
              </>
            )}
            <TableCell className="text-right">{r.net > 0n ? <Money value={r.net} currency={currency} /> : null}</TableCell>
            <TableCell className="pr-6 text-right">{r.net < 0n ? <Money value={-r.net} currency={currency} /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="hidden sm:table-cell" />
          <TableCell className="pl-6 sm:pl-2">
            <span className="mr-2 font-semibold">Total</span>
            <StatusPill status={ok ? "PASS" : "FAIL"} label={ok ? "Seimbang" : "Tidak seimbang"} />
          </TableCell>
          {withMove && (
            <>
              <TableCell className={`text-right ${hide}`}><Money value={opening} currency={currency} /></TableCell>
              <TableCell className={`text-right ${hide}`}><Money value={mdr} strong currency={currency} /></TableCell>
              <TableCell className={`text-right ${hide}`}><Money value={mcr} strong currency={currency} /></TableCell>
            </>
          )}
          <TableCell className="text-right"><Money value={dr} strong currency={currency} /></TableCell>
          <TableCell className="pr-6 text-right"><Money value={cr} strong currency={currency} /></TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Money } from "@/components/app/money";
import type { FsItem } from "@/lib/reports/ledger";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Comparison columns hide on phones so account names stay readable. */
const HIDE_ON_PHONE = "hidden sm:table-cell";

/** Financial-statement table: section → FS line → accounts (each links to its ledger). */
export type FsSection = { title?: string; items: FsItem[][]; total?: { label: string; values: bigint[]; strong?: boolean } };

export function FsTable({ columns, sections, accountHref, currency = "IDR" }: { columns: string[]; sections: FsSection[]; accountHref: (code: string) => string; currency?: string }) {
  const lineKeys = (items: FsItem[][]) => {
    const keys: string[] = [];
    for (const col of items) for (const i of col) if (!keys.includes(i.fsLine)) keys.push(i.fsLine);
    return keys;
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="py-2 pl-6 text-left font-medium" />
          {columns.map((c, i) => (
            <TableHead key={c} className={cn("py-2 pr-6 text-right font-medium", i > 0 && HIDE_ON_PHONE)}>{c}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((s, si) => (
          <SectionRows key={si} section={s} keys={lineKeys(s.items)} accountHref={accountHref} currency={currency} />
        ))}
      </TableBody>
    </Table>
  );
}

function SectionRows({ section, keys, accountHref, currency }: { section: FsSection; keys: string[]; accountHref: (code: string) => string; currency: string }) {
  return (
    <>
      {section.title && (
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableCell colSpan={section.items.length + 1} className="pt-5 pb-1 pl-6 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</TableCell>
        </TableRow>
      )}
      {keys.map((k) => {
        const cells = section.items.map((col) => col.find((i) => i.fsLine === k));
        const label = cells.find(Boolean)!.label;
        const accountCodes = [...new Set(cells.flatMap((c) => c?.accounts.map((a) => a.code) ?? []))];
        return (
          <Fragment key={k}>
            <TableRow className="border-t border-b-0 border-border/60">
              <TableCell className={cn("py-1.5 pl-6 font-medium whitespace-normal", k === "SUSPENSE" && "text-review")}>{label}</TableCell>
              {cells.map((c, i) => (
                <TableCell key={i} className={cn("py-1.5 pr-6 text-right font-medium", i > 0 && HIDE_ON_PHONE)}><Money value={c?.amount ?? 0n} currency={currency} /></TableCell>
              ))}
            </TableRow>
            {accountCodes.map((code) => {
              const name = cells.flatMap((c) => c?.accounts ?? []).find((a) => a.code === code)!.name;
              return (
                <TableRow key={code} className="border-b-0 text-muted-foreground hover:bg-muted/40">
                  <TableCell className="py-1 pl-10 whitespace-normal">
                    <Link href={accountHref(code)} className="underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary" data-testid="fs-account-link">
                      <span className="num">{code}</span> {name}
                    </Link>
                  </TableCell>
                  {cells.map((c, i) => (
                    <TableCell key={i} className={cn("py-1 pr-6 text-right", i > 0 && HIDE_ON_PHONE)}><Money value={c?.accounts.find((a) => a.code === code)?.amount ?? 0n} currency={currency} /></TableCell>
                  ))}
                </TableRow>
              );
            })}
          </Fragment>
        );
      })}
      {section.total && (
        <TableRow className="border-t-2 border-b-0 border-foreground/15 hover:bg-transparent">
          <TableCell className={cn("py-2 pl-6", section.total.strong ? "font-semibold" : "font-medium")}>{section.total.label}</TableCell>
          {section.total.values.map((v, i) => (
            <TableCell key={i} className={cn("py-2 pr-6 text-right", i > 0 && HIDE_ON_PHONE)}><Money value={v} strong={section.total!.strong} currency={currency} /></TableCell>
          ))}
        </TableRow>
      )}
    </>
  );
}

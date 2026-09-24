import { Fragment } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Money } from "@/components/app/money";
import type { FsItem } from "@/lib/reports/ledger";

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
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-2 pl-6 text-left font-medium" />
          {columns.map((c, i) => (
            <th key={c} className={cn("py-2 pr-6 text-right font-medium", i > 0 && HIDE_ON_PHONE)}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((s, si) => (
          <SectionRows key={si} section={s} keys={lineKeys(s.items)} accountHref={accountHref} currency={currency} />
        ))}
      </tbody>
    </table>
  );
}

function SectionRows({ section, keys, accountHref, currency }: { section: FsSection; keys: string[]; accountHref: (code: string) => string; currency: string }) {
  return (
    <>
      {section.title && (
        <tr>
          <td colSpan={section.items.length + 1} className="pt-5 pb-1 pl-6 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</td>
        </tr>
      )}
      {keys.map((k) => {
        const cells = section.items.map((col) => col.find((i) => i.fsLine === k));
        const label = cells.find(Boolean)!.label;
        const accountCodes = [...new Set(cells.flatMap((c) => c?.accounts.map((a) => a.code) ?? []))];
        return (
          <Fragment key={k}>
            <tr className="border-t border-border/60">
              <td className={cn("py-1.5 pl-6 font-medium", k === "SUSPENSE" && "text-review")}>{label}</td>
              {cells.map((c, i) => (
                <td key={i} className={cn("py-1.5 pr-6 text-right font-medium", i > 0 && HIDE_ON_PHONE)}><Money value={c?.amount ?? 0n} currency={currency} /></td>
              ))}
            </tr>
            {accountCodes.map((code) => {
              const name = cells.flatMap((c) => c?.accounts ?? []).find((a) => a.code === code)!.name;
              return (
                <tr key={code} className="text-muted-foreground hover:bg-muted/40">
                  <td className="py-1 pl-10">
                    <Link href={accountHref(code)} className="hover:text-primary hover:underline" data-testid="fs-account-link">
                      <span className="num">{code}</span> {name}
                    </Link>
                  </td>
                  {cells.map((c, i) => (
                    <td key={i} className={cn("py-1 pr-6 text-right", i > 0 && HIDE_ON_PHONE)}><Money value={c?.accounts.find((a) => a.code === code)?.amount ?? 0n} currency={currency} /></td>
                  ))}
                </tr>
              );
            })}
          </Fragment>
        );
      })}
      {section.total && (
        <tr className="border-t-2 border-foreground/15">
          <td className={cn("py-2 pl-6", section.total.strong ? "font-semibold" : "font-medium")}>{section.total.label}</td>
          {section.total.values.map((v, i) => (
            <td key={i} className={cn("py-2 pr-6 text-right", i > 0 && HIDE_ON_PHONE)}><Money value={v} strong={section.total!.strong} currency={currency} /></td>
          ))}
        </tr>
      )}
    </>
  );
}

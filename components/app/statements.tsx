import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { Money } from "@/components/app/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EQUITY_ROWS, EQUITY_ROW_LABEL, type CashFlow, type EquityChanges } from "@/lib/reports/statements";
import { formatDate } from "@/lib/format";
import type { NoteCell, Notes } from "@/lib/reports/notes";

/** Laporan Perubahan Ekuitas: one column per equity line, a total column; rows from the opening balance to the closing one. */
export function EquityTable({ data, currency }: { data: EquityChanges; currency: string }) {
  const rows = EQUITY_ROWS.filter((r) => r === "opening" || r === "closing" || data.totals[r] !== 0n || data.values[r].some((v) => v !== 0n));
  return (
    <div className="overflow-x-auto">
      <Table data-testid="equity-changes">
        <TableHeader>
          <TableRow>
            <TableHead className="py-2 pl-6" />
            {data.columns.map((c) => <TableHead key={c.fsLine} className="py-2 pr-4 text-right font-medium whitespace-normal">{c.label}</TableHead>)}
            <TableHead className="py-2 pr-6 text-right font-medium">Jumlah</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const edge = r === "opening" || r === "closing";
            const label = r === "opening" ? `Saldo ${formatDate(data.openedAt)}` : r === "closing" ? `Saldo ${formatDate(data.to)}` : EQUITY_ROW_LABEL[r];
            return (
              <TableRow key={r} className={cn(edge && "font-medium", r === "closing" && "border-t-2 border-foreground/15")} data-testid={`equity-${r}`}>
                <TableCell className="py-1.5 pl-6 whitespace-normal">{label}</TableCell>
                {data.values[r].map((v, i) => <TableCell key={i} className="py-1.5 pr-4 text-right"><Money value={v} currency={currency} /></TableCell>)}
                <TableCell className="py-1.5 pr-6 text-right"><Money value={data.totals[r]} strong={edge} currency={currency} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data.totals.closing !== data.balanceSheetEquity && (
        <p className="px-6 pt-3 text-sm text-fail">Ekuitas di Neraca <Money value={data.balanceSheetEquity} currency={currency} />; selisih <Money value={data.totals.closing - data.balanceSheetEquity} currency={currency} />.</p>
      )}
    </div>
  );
}

/** Laporan Arus Kas (indirect): operating from net profit, investing, financing, then the change and the cash balances. */
export function CashFlowTable({ data, currency }: { data: CashFlow; currency: string }) {
  const section = (title: string, items: CashFlow["operating"], total: bigint, totalLabel: string, lead?: { label: string; amount: bigint }) => (
    <Fragment>
      <TableRow className="border-b-0 hover:bg-transparent">
        <TableCell colSpan={2} className="eyebrow pt-5 pb-1 pl-6 whitespace-normal">{title}</TableCell>
      </TableRow>
      {lead && (
        <TableRow className="border-b-0">
          <TableCell className="py-1.5 pl-6 whitespace-normal">{lead.label}</TableCell>
          <TableCell className="py-1.5 pr-6 text-right"><Money value={lead.amount} currency={currency} /></TableCell>
        </TableRow>
      )}
      {items.map((i) => (
        <TableRow key={i.key} className="border-b-0 text-muted-foreground">
          <TableCell className="py-1 pl-10 whitespace-normal">{i.label} <span className="num text-xs">({i.codes.join(", ")})</span></TableCell>
          <TableCell className="py-1 pr-6 text-right"><Money value={i.amount} currency={currency} /></TableCell>
        </TableRow>
      ))}
      <TableRow className="border-t-2 border-b-0 border-foreground/15 hover:bg-transparent">
        <TableCell className="py-2 pl-6 font-medium whitespace-normal">{totalLabel}</TableCell>
        <TableCell className="py-2 pr-6 text-right"><Money value={total} strong currency={currency} /></TableCell>
      </TableRow>
    </Fragment>
  );
  return (
    <Table data-testid="cash-flow">
      <TableBody>
        {section("Arus kas dari aktivitas operasi", data.operating, data.totals.OPERATING, "Kas bersih dari aktivitas operasi", { label: "Laba bersih", amount: data.netProfit })}
        {section("Arus kas dari aktivitas investasi", data.investing, data.totals.INVESTING, "Kas bersih dari aktivitas investasi")}
        {section("Arus kas dari aktivitas pendanaan", data.financing, data.totals.FINANCING, "Kas bersih dari aktivitas pendanaan")}
        <TableRow className="border-t-2 border-foreground/15 font-medium" data-testid="cash-net">
          <TableCell className="py-2 pl-6 whitespace-normal">Kenaikan (penurunan) bersih kas dan setara kas</TableCell>
          <TableCell className="py-2 pr-6 text-right"><Money value={data.net} strong currency={currency} /></TableCell>
        </TableRow>
        <TableRow className="border-b-0">
          <TableCell className="py-1.5 pl-6 whitespace-normal">Kas dan setara kas {formatDate(data.openedAt)}</TableCell>
          <TableCell className="py-1.5 pr-6 text-right"><Money value={data.openingCash} currency={currency} /></TableCell>
        </TableRow>
        <TableRow className="font-semibold" data-testid="cash-closing">
          <TableCell className="py-2 pl-6 whitespace-normal">Kas dan setara kas {formatDate(data.to)}</TableCell>
          <TableCell className="py-2 pr-6 text-right"><Money value={data.closingCash} strong currency={currency} /></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** CALK draft: numbered notes with their text and tables, then the directors' statement. */
export function NotesView({ data, currency }: { data: Notes; currency: string }) {
  const cell = (c: NoteCell, i: number, strong = false) => (typeof c === "bigint" ? <Money value={c} strong={strong} currency={currency} /> : <span className={cn(i === 0 && "whitespace-normal")}>{c ?? ""}</span>);
  return (
    <div className="space-y-8 px-6" data-testid="notes">
      {data.notes.map((n) => (
        <section key={n.number} className="space-y-2" data-testid={`note-${n.number}`}>
          <h3 className="font-semibold">{n.number}. {n.title}</h3>
          {n.paragraphs.map((p, i) => <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>)}
          {n.tables.map((t, ti) => (
            <div key={ti} className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[320px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>{t.columns.map((c, i) => <th key={i} className={cn("px-3 py-1.5 font-medium", i === 0 ? "text-left" : "text-right")}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {t.rows.map((r, ri) => (
                    <tr key={ri} className="border-t">{r.map((c, i) => <td key={i} className={cn("px-3 py-1", i === 0 ? "text-left" : "text-right")}>{cell(c, i)}</td>)}</tr>
                  ))}
                  {t.total && <tr className="border-t-2 border-foreground/15 font-medium">{t.total.map((c, i) => <td key={i} className={cn("px-3 py-1.5", i === 0 ? "text-left" : "text-right")}>{cell(c, i, true)}</td>)}</tr>}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
      <section className="space-y-1 border-t pt-6 text-sm" data-testid="directors-statement">
        {data.directors.map((line, i) => <p key={i} className={cn(i < 3 && "text-center font-semibold")}>{line}</p>)}
      </section>
    </div>
  );
}

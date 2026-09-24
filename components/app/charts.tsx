"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatRupiahCompact } from "@/lib/money";

type Point = { label: string; cash?: number; revenue?: number; expense?: number; pct?: number };

const rp = (v: number) => formatRupiahCompact(BigInt(Math.round(v)));

/** Single series → no legend; the card title names it. Hover tooltip by default. */
export function CashChart({ data }: { data: Point[] }) {
  const config = { cash: { label: "Saldo kas", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-cash)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-cash)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={70} tickFormatter={rp} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => rp(Number(v))} />} />
        <Area isAnimationActive={false} dataKey="cash" type="monotone" stroke="var(--color-cash)" strokeWidth={2} fill="url(#cashFill)" dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Two series: legend + tooltip; teal fails 3:1 vs surface, so values are also in the table below. */
export function RevenueExpenseChart({ data }: { data: Point[] }) {
  const config = {
    revenue: { label: "Pendapatan", color: "var(--chart-1)" },
    expense: { label: "Beban", color: "var(--chart-4)" },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ left: 8, right: 8, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={70} tickFormatter={rp} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => `${config[n as "revenue" | "expense"]?.label ?? n}: ${rp(Number(v))}`} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar isAnimationActive={false} dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar isAnimationActive={false} dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}

export function AutomationChart({ data }: { data: Point[] }) {
  const config = { pct: { label: "Dikode otomatis", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-40 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 20 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={44} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${v}% tanpa sentuhan manusia`} />} />
        <Bar isAnimationActive={false} dataKey="pct" fill="var(--color-pct)" radius={[4, 4, 0, 0]} maxBarSize={32} label={{ position: "top", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${v}%` }} />
      </BarChart>
    </ChartContainer>
  );
}

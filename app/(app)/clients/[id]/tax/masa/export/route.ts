import { prisma } from "@/lib/db";
import { exportContext } from "@/lib/reports/export-context";
import { recordExport } from "@/lib/reports/export-log";
import { formatPeriod } from "@/lib/format";
import { packApplies } from "@/lib/tax/pack";
import { masaReport } from "@/lib/tax/masa-report";
import { masaWorkbook } from "@/lib/tax/masa-workbook";
import { fakturRecon } from "@/lib/tax/faktur";

/** GET ?entity=<id>&period=YYYY-MM — Kertas kerja pajak masa for one company in Rupiah (I4c). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await exportContext(req, id);
  if (!ctx) return new Response("Klien tidak ditemukan", { status: 404 });
  const entity = ctx.scope.entityIds.length === 1 ? ctx.client.entities.find((e) => e.id === ctx.scope.entityIds[0]) : undefined;
  if (!entity || !packApplies(entity)) return new Response("Pajak masa dibuat untuk satu badan usaha dengan pembukuan Rupiah. Pilih perusahaannya.", { status: 400 });
  const report = await masaReport(prisma, { clientId: ctx.client.id, entityId: entity.id, year: ctx.period.year, month: ctx.period.month });
  if (!report) return new Response("Entitas tidak ditemukan", { status: 404 });
  const faktur = await fakturRecon(prisma, { clientId: ctx.client.id, entityId: entity.id, year: ctx.period.year, month: ctx.period.month });
  const body = await masaWorkbook(report, ctx.meta, faktur);
  await recordExport(prisma, { clientId: ctx.client.id, entityId: entity.id, scope: entity.name, year: ctx.period.year, month: ctx.period.month, file: "Kertas kerja pajak masa", final: !ctx.meta.draft });
  const name = `pajak-masa-${entity.shortName.replace(/[^\w-]+/g, "_")}-${formatPeriod(ctx.period.year, ctx.period.month).replace(/\s+/g, "-")}.xlsx`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
export const runtime = "nodejs";

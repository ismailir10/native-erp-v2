import { prisma } from "@/lib/db";
import { managementWorkbook } from "@/lib/reports/management-pack";
import { exportContext } from "@/lib/reports/export-context";
import { recordExport } from "@/lib/reports/export-log";
import { formatPeriod } from "@/lib/format";

/** GET ?entity=<id>&period=YYYY-MM — Laporan manajemen bulanan for one company (I4b): the month against last month, with its commentary. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await exportContext(req, id);
  if (!ctx) return new Response("Klien tidak ditemukan", { status: 404 });
  const entity = ctx.scope.entityIds.length === 1 ? ctx.client.entities.find((e) => e.id === ctx.scope.entityIds[0]) : undefined;
  if (!entity) return new Response("Laporan manajemen dibuat untuk satu perusahaan. Pilih perusahaannya, bukan gabungan.", { status: 400 });
  const body = await managementWorkbook(prisma, { clientId: ctx.client.id, entityId: entity.id, year: ctx.period.year, month: ctx.period.month, meta: ctx.meta });
  await recordExport(prisma, { clientId: ctx.client.id, entityId: entity.id, scope: entity.name, year: ctx.period.year, month: ctx.period.month, file: "Laporan manajemen", final: !ctx.meta.draft });
  const name = `laporan-manajemen-${entity.shortName.replace(/[^\w-]+/g, "_")}-${formatPeriod(ctx.period.year, ctx.period.month).replace(/\s+/g, "-")}.xlsx`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
export const runtime = "nodejs";

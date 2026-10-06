import { prisma } from "@/lib/db";
import { financialStatementsWorkbook, statementsFileName } from "@/lib/reports/workbook";
import { FxMissingError } from "@/lib/reports/fx";
import { exportContext } from "@/lib/reports/export-context";
import { recordExport } from "@/lib/reports/export-log";

/** GET ?entity=<id|combined>&period=YYYY-MM — the financial statements as one Excel workbook (accounting-rules 1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await exportContext(req, id);
    if (!ctx) return new Response("Klien tidak ditemukan", { status: 404 });
    const body = await financialStatementsWorkbook(prisma, ctx.scope, ctx.period.year, ctx.period.month, ctx.meta);
    await recordExport(prisma, { clientId: ctx.client.id, entityId: ctx.scope.entityIds.length === 1 ? ctx.scope.entityIds[0] : null, scope: ctx.title, year: ctx.period.year, month: ctx.period.month, file: "Laporan keuangan (Excel)", final: !ctx.meta.draft });
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${statementsFileName(ctx.title, ctx.period.year, ctx.period.month)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof FxMissingError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
export const runtime = "nodejs";

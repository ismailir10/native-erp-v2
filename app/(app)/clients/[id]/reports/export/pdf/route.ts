import { prisma } from "@/lib/db";
import { statementsFileName } from "@/lib/reports/workbook";
import { financialStatementsPdf } from "@/lib/reports/pdf";
import { FxMissingError } from "@/lib/reports/fx";
import { exportContext } from "@/lib/reports/export-context";
import { recordExport } from "@/lib/reports/export-log";

/** GET ?entity=<id|combined>&period=YYYY-MM — the financial statements as one PDF ready to send (UC-K3). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await exportContext(req, id);
    if (!ctx) return new Response("Klien tidak ditemukan", { status: 404 });
    const body = await financialStatementsPdf(prisma, ctx.scope, ctx.period.year, ctx.period.month, ctx.meta);
    await recordExport(prisma, { clientId: ctx.client.id, entityId: ctx.scope.entityIds.length === 1 ? ctx.scope.entityIds[0] : null, scope: ctx.title, year: ctx.period.year, month: ctx.period.month, file: "Laporan keuangan (PDF)", final: !ctx.meta.draft });
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${statementsFileName(ctx.title, ctx.period.year, ctx.period.month, "pdf")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof FxMissingError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
export const runtime = "nodejs";

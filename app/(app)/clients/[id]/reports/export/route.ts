import { prisma } from "@/lib/db";
import { getClientForFirm, getCurrentFirm } from "@/lib/tenant";
import { parsePeriod, resolveEntityScope } from "@/lib/scope";
import { financialStatementsWorkbook, statementsFileName } from "@/lib/reports/workbook";
import { FxMissingError } from "@/lib/reports/fx";
import { reasonText, reportStatus } from "@/lib/reports/status";
import { formatMoney } from "@/lib/money";

/** GET ?entity=<id|combined>&period=YYYY-MM — the financial statements as one Excel workbook (accounting-rules 12). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientForFirm(id).catch(() => null);
  if (!client) return new Response("Klien tidak ditemukan", { status: 404 });
  const url = new URL(req.url);
  const scope = resolveEntityScope(url.searchParams.get("entity") ?? undefined, client.entities);
  const now = new Date();
  const period = parsePeriod(url.searchParams.get("period") ?? undefined, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const title = scope.mode === "combined" ? `${client.name} (gabungan)` : client.entities.find((e) => e.id === scope.value)!.name;
  const firm = await getCurrentFirm();
  try {
    const status = await reportStatus(prisma, client.id, scope.entityIds, period.year, period.month);
    const currency = client.entities.find((e) => scope.entityIds.includes(e.id))?.functionalCurrency ?? "IDR";
    const draft = status.locked ? undefined : status.reasons.length ? `belum final: ${status.reasons.map((r) => reasonText(r, (v) => formatMoney(v, currency))).join("; ")}; bulan belum ditutup.` : "bulan belum ditutup.";
    const body = await financialStatementsWorkbook(prisma, { clientId: client.id, entityIds: scope.entityIds }, period.year, period.month, { firm: firm.name, title, draft });
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${statementsFileName(title, period.year, period.month)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof FxMissingError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
export const runtime = "nodejs";

import { prisma } from "@/lib/db";
import { findClientForMember, getCurrentFirm } from "@/lib/tenant";
import { parsePeriod, resolveEntityScope } from "@/lib/scope";
import { formatPeriod } from "@/lib/format";
import { ownerQuestions, ownerQuestionsWorkbook } from "@/lib/review-questions";

/** GET ?entity=<id|combined>&period=YYYY-MM — the lines waiting in Review as a question list for the client, largest first (UC-B3). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await findClientForMember(id);
  if (!client) return new Response("Klien tidak ditemukan", { status: 404 });
  const url = new URL(req.url);
  const scope = resolveEntityScope(url.searchParams.get("entity") ?? undefined, client.entities);
  const now = new Date();
  const period = parsePeriod(url.searchParams.get("period") ?? undefined, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const through = new Date(Date.UTC(period.year, period.month, 0));
  const firm = await getCurrentFirm();
  const rows = await ownerQuestions(prisma, { firmId: client.firmId, clientId: client.id, entityIds: scope.entityIds, through });
  const body = await ownerQuestionsWorkbook(rows, { firm: firm.name, client: client.name, through });
  const file = `pertanyaan-${client.name.replace(/[^\w-]+/g, "_")}-${formatPeriod(period.year, period.month).replace(/\s+/g, "-")}.xlsx`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
export const runtime = "nodejs";

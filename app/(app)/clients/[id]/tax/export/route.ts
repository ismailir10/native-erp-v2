import { prisma } from "@/lib/db";
import { findClientForMember, getCurrentFirm } from "@/lib/tenant";
import { parsePeriod } from "@/lib/scope";
import { packApplies, taxPack } from "@/lib/tax/pack";
import { taxWorkpaper } from "@/lib/tax/workpaper";
import { recordExport } from "@/lib/reports/export-log";

/** GET ?entity=<id>&period=YYYY-MM — the tax pack's Excel kertas kerja for one company (accounting-rules 5d). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await findClientForMember(id);
  if (!client) return new Response("Klien tidak ditemukan", { status: 404 });
  const url = new URL(req.url);
  const entity = client.entities.find((e) => e.id === url.searchParams.get("entity"));
  if (!entity || !packApplies(entity)) return new Response("Pilih badan usaha dengan pembukuan Rupiah", { status: 400 });
  if (client.fiscalYearEndMonth !== 12) return new Response("Pajak Badan untuk tahun buku non-kalender belum didukung di Buku.", { status: 400 });
  const now = new Date();
  const period = parsePeriod(url.searchParams.get("period") ?? undefined, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const pack = await taxPack(prisma, client.id, entity.id, period.year, period.month);
  if (!pack) return new Response("Entitas tidak ditemukan", { status: 404 });
  const firm = await getCurrentFirm();
  const body = await taxWorkpaper(prisma, pack, { firm: firm.name, client: client.name, npwp: entity.npwp });
  const locked = await prisma.period.findFirst({ where: { clientId: client.id, year: period.year, month: period.month, status: "LOCKED" }, select: { id: true } });
  await recordExport(prisma, { clientId: client.id, entityId: entity.id, scope: entity.name, year: period.year, month: period.month, file: "Kertas kerja PPh Badan", final: !!locked });
  const name = `kertas-kerja-pph-badan-${entity.shortName.replace(/[^\w-]+/g, "_")}-${period.key}.xlsx`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
export const runtime = "nodejs";

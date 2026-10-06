import "dotenv/config";
import { createPrisma } from "@/lib/db";
import { closeTimeline, formatDuration } from "@/lib/controls/timeline";
import { formatPeriod } from "@/lib/format";

/**
 * npm run close:timeline -- [--client <id|name>] [--period YYYY-MM]
 *
 * Read-only. Per client-month: files in (first, last), last review, locked, first report sent after the lock, and the time from the
 * first file to the lock and to that report (ADR 0014's north-star metric; docs/real-month.md). Without --client: every client.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const db = createPrisma();
  const who = arg("client");
  const period = arg("period")?.match(/^(\d{4})-(\d{2})$/);
  if (arg("period") && !period) throw new Error("--period harus berbentuk YYYY-MM");
  const only = period ? { year: Number(period[1]), month: Number(period[2]) } : undefined;
  const clients = await db.client.findMany({
    where: who ? { OR: [{ id: who }, { name: { contains: who, mode: "insensitive" } }] } : {},
    select: { id: true, name: true, firm: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  if (!clients.length) throw new Error(`Klien "${who}" tidak ditemukan`);
  const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
  for (const c of clients) {
    const months = await closeTimeline(db, c.id, only);
    console.log(`\n${c.name} · ${c.firm.name} (${c.id})`);
    if (!months.length) {
      console.log("  belum ada file, kunci, atau laporan terkirim");
      continue;
    }
    console.table(
      months.map((m) => ({
        bulan: formatPeriod(m.year, m.month),
        file: m.files,
        "file pertama": when(m.firstFileAt),
        "file terakhir": when(m.lastFileAt),
        "tinjau terakhir": when(m.lastReviewAt),
        dikunci: when(m.lockedAt),
        "terkirim pertama": when(m.firstSentAt),
        "file → kunci": formatDuration(m.toLockMs),
        "file → terkirim": formatDuration(m.toSentMs),
      })),
    );
  }
  console.log("\nWaktu dalam UTC. Terkirim = laporan atau kertas kerja pertama yang diunduh setelah bulan dikunci.");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

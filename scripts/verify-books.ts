import "dotenv/config";
import { createPrisma } from "@/lib/db";
import { verifyBooks } from "@/lib/demo/verify";

/** npm run verify:books — layer-2 check: app TB vs generator ground truth. */
async function main() {
  const db = createPrisma();
  const includeLive = process.argv.includes("--include-live");
  const r = await verifyBooks(db, { includeLive });
  if (r.failures.length) {
    console.error(`GAGAL — ${r.failures.length} dari ${r.checks} pemeriksaan:`);
    for (const f of r.failures.slice(0, 50)) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`ALL PASS — ${r.checks} pemeriksaan saldo cocok dengan ground truth.`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

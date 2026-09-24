import { createPrisma } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";

/** Build-time: seed the demo firm only when the database is empty (never overwrites a live demo). */
async function main() {
  const db = createPrisma();
  const firms = await db.firm.count();
  if (firms > 0) {
    console.log(`✓ Demo data present (${firms} firm) — skipping seed`);
  } else {
    const t0 = Date.now();
    await seedDemo(db);
    console.log(`✓ Demo data seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

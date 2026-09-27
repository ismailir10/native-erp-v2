import { createPrisma } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { seedDemoAdmin } from "@/lib/demo/admin";

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
  // Runs on every build so a rotated DEMO_ADMIN_PASSWORD takes effect without a reseed.
  await seedDemoAdmin(db, console.log);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { writeFileSync, mkdirSync } from "node:fs";
import "dotenv/config";
import { createPrisma } from "@/lib/db";
import { liveUploadFile, seedDemo } from "@/lib/demo/seed";

/** npm run demo:reset — rebuild the demo firm through the real pipeline (0 real AI calls). */
async function main() {
  const db = createPrisma();
  const t0 = Date.now();
  await seedDemo(db, { log: console.log, liveAi: process.env.DEMO_LIVE_AI === "1" });
  const f = await liveUploadFile();
  mkdirSync("public/demo", { recursive: true });
  writeFileSync(`public/demo/${f.fileName}`, f.data);
  console.log(`\nSelesai dalam ${((Date.now() - t0) / 1000).toFixed(1)} dtk. File upload live: public/demo/${f.fileName}`);
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

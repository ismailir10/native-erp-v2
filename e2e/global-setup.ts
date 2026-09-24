import { execSync } from "node:child_process";

/** Fresh demo data before the walk (same as the "Reset data demo" button). */
export default function setup() {
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env: process.env });
}

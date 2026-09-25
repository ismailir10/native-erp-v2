import { execSync } from "node:child_process";

/** Run the Prisma ESM fixture through the same tsx runtime as the seed. */
export default function setup() {
  execSync("npx tsx scripts/e2e-setup.ts", { stdio: "inherit", env: process.env });
}

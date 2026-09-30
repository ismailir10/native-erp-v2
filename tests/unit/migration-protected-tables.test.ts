import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Production keeps its members (FirmMember), the encrypted AI key and other settings (AppSetting), the firm and the Drive connection
 * across every deploy: `prisma migrate deploy` runs on the real database. From 2026-09-30 a migration may add to these tables
 * (new columns, indexes, foreign keys) but never delete, rewrite, rename or drop what is in them.
 */
const PROTECTED = ["FirmMember", "AppSetting", "Firm", "DriveConnection"];
const FROM = "20260930000000";
const DIR = join(process.cwd(), "prisma", "migrations");

const table = (t: string) => `"?(?:public"?\\."?)?${t}"?`;
const anyProtected = PROTECTED.join("|");
const DESTRUCTIVE: [string, RegExp][] = [
  ["DELETE FROM", new RegExp(`\\bDELETE\\s+FROM\\s+${table(`(?:${anyProtected})`)}\\b`, "i")],
  ["TRUNCATE", new RegExp(`\\bTRUNCATE\\b[^;]*${table(`(?:${anyProtected})`)}\\b`, "i")],
  ["DROP TABLE", new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${table(`(?:${anyProtected})`)}\\b`, "i")],
  ["UPDATE", new RegExp(`\\bUPDATE\\s+${table(`(?:${anyProtected})`)}\\s+SET\\b`, "i")],
  ["ALTER … DROP/ALTER/RENAME", new RegExp(`\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?${table(`(?:${anyProtected})`)}\\s+(?:DROP\\s+(?:COLUMN|CONSTRAINT)|ALTER\\s+COLUMN|RENAME)\\b`, "i")],
];

const files = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name >= FROM)
  .map((d) => ({ name: d.name, sql: readFileSync(join(DIR, d.name, "migration.sql"), "utf8").replace(/--[^\n]*/g, "") }));

describe("migrations keep members, AI settings, firm and Drive connection intact", () => {
  it.each(files.map((f) => [f.name, f.sql] as const))("%s never deletes, rewrites or drops a protected table's rows or columns", (_name, sql) => {
    for (const [label, re] of DESTRUCTIVE) expect(sql, label).not.toMatch(re);
  });

  it("detects each destructive form (the guard itself works)", () => {
    const samples = [
      'DELETE FROM "AppSetting" WHERE 1=1;',
      'TRUNCATE TABLE "Client", "FirmMember" CASCADE;',
      'DROP TABLE "FirmMember";',
      'UPDATE "AppSetting" SET "value" = \'\';',
      'ALTER TABLE "FirmMember" DROP COLUMN "email";',
      'ALTER TABLE "Firm" RENAME TO "Kantor";',
    ];
    for (const s of samples) expect(DESTRUCTIVE.some(([, re]) => re.test(s)), s).toBe(true);
    for (const ok of ['ALTER TABLE "Entity" ADD COLUMN "x" TEXT;', 'ALTER TABLE "PeriodUnlockLog" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "FirmMember"("id");', 'ALTER TABLE "FirmMember" ADD COLUMN "note" TEXT;']) {
      expect(DESTRUCTIVE.some(([, re]) => re.test(ok)), ok).toBe(false);
    }
  });
});

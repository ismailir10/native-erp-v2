-- CKPN settings by effective month (review of docs/cycles/2026-09-29-ckpn-psak109.md): existing rows apply from January 2000.
-- DropIndex
DROP INDEX "CkpnSetting_entityId_key";

-- AlterTable
ALTER TABLE "CkpnSetting" ADD COLUMN     "effectiveMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "effectiveYear" INTEGER NOT NULL DEFAULT 2000;

-- CreateIndex
CREATE UNIQUE INDEX "CkpnSetting_entityId_effectiveYear_effectiveMonth_key" ON "CkpnSetting"("entityId", "effectiveYear", "effectiveMonth");

ALTER TABLE "CkpnSetting" ADD CONSTRAINT "CkpnSetting_effective_check" CHECK ("effectiveMonth" BETWEEN 1 AND 12 AND "effectiveYear" BETWEEN 2000 AND 2100);

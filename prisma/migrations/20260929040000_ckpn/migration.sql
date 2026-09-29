-- CKPN PSAK 109 (cycle docs/cycles/2026-09-29-ckpn-psak109.md).
-- CreateEnum
CREATE TYPE "CkpnMethod" AS ENUM ('ROLL_RATE', 'MANUAL');

-- CreateTable
CREATE TABLE "CkpnSetting" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "method" "CkpnMethod" NOT NULL DEFAULT 'ROLL_RATE',
    "historyMonths" INTEGER NOT NULL DEFAULT 12,
    "currentBp" INTEGER NOT NULL DEFAULT 0,
    "d1to30Bp" INTEGER NOT NULL DEFAULT 0,
    "d31to60Bp" INTEGER NOT NULL DEFAULT 0,
    "d61to90Bp" INTEGER NOT NULL DEFAULT 0,
    "lastBucketBp" INTEGER NOT NULL DEFAULT 10000,
    "forwardBp" INTEGER NOT NULL DEFAULT 10000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CkpnSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CkpnSetting_entityId_key" ON "CkpnSetting"("entityId");

-- AddForeignKey
ALTER TABLE "CkpnSetting" ADD CONSTRAINT "CkpnSetting_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "CkpnSetting" ADD CONSTRAINT "CkpnSetting_rates_check" CHECK ("currentBp" BETWEEN 0 AND 10000 AND "d1to30Bp" BETWEEN 0 AND 10000 AND "d31to60Bp" BETWEEN 0 AND 10000 AND "d61to90Bp" BETWEEN 0 AND 10000 AND "lastBucketBp" BETWEEN 0 AND 10000);
ALTER TABLE "CkpnSetting" ADD CONSTRAINT "CkpnSetting_forward_check" CHECK ("forwardBp" BETWEEN 0 AND 30000);
ALTER TABLE "CkpnSetting" ADD CONSTRAINT "CkpnSetting_history_check" CHECK ("historyMonths" BETWEEN 2 AND 36);

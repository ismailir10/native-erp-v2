-- Fixed-asset register (cycle docs/cycles/2026-09-28-fixed-asset-register.md).
-- CreateEnum
CREATE TYPE "AssetTaxGroup" AS ENUM ('KELOMPOK_1', 'KELOMPOK_2', 'KELOMPOK_3', 'KELOMPOK_4', 'BANGUNAN_PERMANEN', 'BANGUNAN_TIDAK_PERMANEN', 'TANAH');

-- CreateEnum
CREATE TYPE "FiscalMethod" AS ENUM ('GARIS_LURUS', 'SALDO_MENURUN');

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxGroup" "AssetTaxGroup" NOT NULL,
    "fiscalMethod" "FiscalMethod" NOT NULL,
    "acquiredOn" DATE NOT NULL,
    "cost" BIGINT NOT NULL,
    "residual" BIGINT NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER,
    "openingAccumulated" BIGINT NOT NULL DEFAULT 0,
    "assetAccountId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "sourceEntryId" TEXT,
    "disposedOn" DATE,
    "proceeds" BIGINT,
    "disposalEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_scheduleId_key" ON "FixedAsset"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_disposalEntryId_key" ON "FixedAsset"("disposalEntryId");

-- CreateIndex
CREATE INDEX "FixedAsset_clientId_idx" ON "FixedAsset"("clientId");

-- CreateIndex
CREATE INDEX "FixedAsset_entityId_idx" ON "FixedAsset"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_sourceEntryId_assetAccountId_key" ON "FixedAsset"("sourceEntryId", "assetAccountId");

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AdjustmentSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposalEntryId_fkey" FOREIGN KEY ("disposalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Register invariants (accounting-rules 5b).
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_cost_check" CHECK ("cost" > 0);
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_residual_check" CHECK ("residual" >= 0 AND "residual" < "cost");
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_opening_accumulated_check" CHECK ("openingAccumulated" >= 0 AND "openingAccumulated" <= "cost" - "residual");
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_life_check" CHECK ("usefulLifeMonths" IS NULL OR ("usefulLifeMonths" >= 1 AND "usefulLifeMonths" <= 600));
-- A disposal is recorded whole: date, proceeds and entry together.
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_disposal_check" CHECK (("disposedOn" IS NULL) = ("disposalEntryId" IS NULL) AND ("disposedOn" IS NULL) = ("proceeds" IS NULL) AND ("proceeds" IS NULL OR "proceeds" >= 0));

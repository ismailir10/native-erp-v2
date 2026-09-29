-- Tax pack gaps (cycle docs/cycles/2026-09-29-tax-pack-gaps.md).
-- AlterTable
ALTER TABLE "FiscalCorrection" ADD COLUMN     "category" TEXT,
ADD COLUMN     "percent" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "TaxLossCarryforward" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "originYear" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxLossCarryforward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxLossCarryforward_taxYearId_originYear_key" ON "TaxLossCarryforward"("taxYearId", "originYear");

-- AddForeignKey
ALTER TABLE "TaxLossCarryforward" ADD CONSTRAINT "TaxLossCarryforward_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxLossCarryforward" ADD CONSTRAINT "TaxLossCarryforward_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "TaxLossCarryforward" ADD CONSTRAINT "TaxLossCarryforward_amount_check" CHECK ("amount" > 0);
ALTER TABLE "TaxLossCarryforward" ADD CONSTRAINT "TaxLossCarryforward_origin_check" CHECK ("originYear" >= 2000 AND "originYear" <= 2100);
ALTER TABLE "FiscalCorrection" ADD CONSTRAINT "FiscalCorrection_percent_check" CHECK ("percent" >= 1 AND "percent" <= 100);

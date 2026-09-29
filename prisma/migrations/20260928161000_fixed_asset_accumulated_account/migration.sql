-- The accumulated-depreciation account of an asset, also when it has no schedule (fully depreciated in Saldo Awal).
-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "accumulatedAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_accumulatedAccountId_fkey" FOREIGN KEY ("accumulatedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Land has none; every depreciable asset has one.
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_accumulated_account_check" CHECK (("taxGroup" = 'TANAH') = ("accumulatedAccountId" IS NULL));

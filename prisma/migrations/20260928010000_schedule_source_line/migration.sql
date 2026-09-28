-- AlterTable
ALTER TABLE "AdjustmentSchedule" ADD COLUMN     "sourceAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A source line is a line of the source entry: its account never stands without the entry.
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_source_line_check" CHECK ("sourceAccountId" IS NULL OR "sourceEntryId" IS NOT NULL);

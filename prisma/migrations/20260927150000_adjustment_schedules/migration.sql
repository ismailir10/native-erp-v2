-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('DEPRECIATION', 'AMORTIZATION', 'ACCRUAL');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "installment" INTEGER,
ADD COLUMN     "scheduleId" TEXT;

-- CreateTable
CREATE TABLE "AdjustmentSchedule" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "ScheduleKind" NOT NULL,
    "memo" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "months" INTEGER NOT NULL,
    "startYear" INTEGER NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "reverse" BOOLEAN NOT NULL DEFAULT false,
    "sourceEntryId" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjustmentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdjustmentSchedule_clientId_idx" ON "AdjustmentSchedule"("clientId");

-- CreateIndex
CREATE INDEX "AdjustmentSchedule_entityId_idx" ON "AdjustmentSchedule"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_scheduleId_installment_key" ON "JournalEntry"("scheduleId", "installment");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AdjustmentSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Schedules are arithmetic the ledger relies on (accounting-rules 5a): a positive total, at least one installment, a real month,
-- two different accounts, and an installment number on every scheduled entry.
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_amount_check" CHECK ("amount" > 0);
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_months_check" CHECK ("months" >= 1 AND "months" <= 600);
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_start_check" CHECK ("startMonth" BETWEEN 1 AND 12);
ALTER TABLE "AdjustmentSchedule" ADD CONSTRAINT "AdjustmentSchedule_accounts_check" CHECK ("debitAccountId" <> "creditAccountId");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_schedule_installment_check" CHECK (("scheduleId" IS NULL) = ("installment" IS NULL));

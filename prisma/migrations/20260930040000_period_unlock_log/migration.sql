-- Audit trail for reopening a closed month (admin only, with a reason). Additive: a new table, nothing existing is altered.
-- Rollback: DROP TABLE "PeriodUnlockLog";
CREATE TABLE "PeriodUnlockLog" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "unlockedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodUnlockLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PeriodUnlockLog_clientId_createdAt_idx" ON "PeriodUnlockLog"("clientId", "createdAt");

ALTER TABLE "PeriodUnlockLog" ADD CONSTRAINT "PeriodUnlockLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PeriodUnlockLog" ADD CONSTRAINT "PeriodUnlockLog_unlockedById_fkey" FOREIGN KEY ("unlockedById") REFERENCES "FirmMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

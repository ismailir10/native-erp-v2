-- Catatan manajemen (I5b): the accountant-approved note per company and month.
-- CreateTable
CREATE TABLE "ReportComment" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportComment_clientId_idx" ON "ReportComment"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportComment_entityId_year_month_key" ON "ReportComment"("entityId", "year", "month");


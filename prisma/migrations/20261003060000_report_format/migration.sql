-- Format laporan per klien (UC-K3): presentation only; no row = the standard format.
-- CreateTable
CREATE TABLE "ReportFormat" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "format" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportFormat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportFormat_clientId_key" ON "ReportFormat"("clientId");

-- AddForeignKey
ALTER TABLE "ReportFormat" ADD CONSTRAINT "ReportFormat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFormat" ADD CONSTRAINT "ReportFormat_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


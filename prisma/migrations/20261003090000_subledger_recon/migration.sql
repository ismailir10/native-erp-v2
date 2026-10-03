-- Rekonsiliasi subledger (use-case UC-A1): a client's own aging at a date, compared with the ledger; a difference beyond the
-- threshold opens a Temuan SUBLEDGER_DIFFERENCE. The rows keep sheet!row for tracing.
-- CreateEnum
CREATE TYPE "SubledgerKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- AlterEnum
ALTER TYPE "FindingKind" ADD VALUE 'SUBLEDGER_DIFFERENCE';

-- CreateTable
CREATE TABLE "SubledgerImport" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "SubledgerKind" NOT NULL,
    "asOf" DATE NOT NULL,
    "fileName" TEXT NOT NULL,
    "accountCodes" TEXT[],
    "threshold" BIGINT NOT NULL DEFAULT 1000,
    "findingId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubledgerImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubledgerRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "counterparty" TEXT NOT NULL,
    "total" BIGINT NOT NULL,
    "buckets" JSONB NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "rounded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SubledgerRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubledgerImport_findingId_key" ON "SubledgerImport"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "SubledgerImport_entityId_kind_asOf_key" ON "SubledgerImport"("entityId", "kind", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "SubledgerRow_importId_position_key" ON "SubledgerRow"("importId", "position");

-- AddForeignKey
ALTER TABLE "SubledgerImport" ADD CONSTRAINT "SubledgerImport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubledgerImport" ADD CONSTRAINT "SubledgerImport_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubledgerImport" ADD CONSTRAINT "SubledgerImport_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubledgerImport" ADD CONSTRAINT "SubledgerImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubledgerRow" ADD CONSTRAINT "SubledgerRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SubledgerImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "SubledgerImport" ADD CONSTRAINT "SubledgerImport_threshold_check" CHECK ("threshold" >= 0);

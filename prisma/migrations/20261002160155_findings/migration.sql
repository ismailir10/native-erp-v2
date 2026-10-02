-- Temuan (ADR 0012): differences Buku does not plug. A resolved finding carries its decision, who and when; an open one carries none.
-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('OPENING_DIFFERENCE');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "FindingKind" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "question" TEXT NOT NULL,
    "sourceEntryId" TEXT,
    "openedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolvedEntryId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Finding_resolvedEntryId_key" ON "Finding"("resolvedEntryId");

-- CreateIndex
CREATE INDEX "Finding_entityId_status_idx" ON "Finding"("entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_clientId_number_key" ON "Finding"("clientId", "number");

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_resolvedEntryId_fkey" FOREIGN KEY ("resolvedEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A finding is open with no decision, or resolved with the decision and its time.
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_resolution_check" CHECK ((status = 'OPEN' AND resolution IS NULL AND "resolvedAt" IS NULL) OR (status = 'RESOLVED' AND resolution IS NOT NULL AND "resolvedAt" IS NOT NULL));

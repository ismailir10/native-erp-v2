-- Lease register PSAK 116 (cycle docs/cycles/2026-09-29-lease-psak116.md).
-- CreateEnum
CREATE TYPE "LeaseTiming" AS ENUM ('ADVANCE', 'ARREARS');

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lessor" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "payment" BIGINT NOT NULL,
    "intervalMonths" INTEGER NOT NULL,
    "timing" "LeaseTiming" NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "entryId" TEXT,
    "cancelEntryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeasePosting" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,

    CONSTRAINT "LeasePosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lease_entryId_key" ON "Lease"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_cancelEntryId_key" ON "Lease"("cancelEntryId");

-- CreateIndex
CREATE INDEX "Lease_clientId_idx" ON "Lease"("clientId");

-- CreateIndex
CREATE INDEX "Lease_entityId_idx" ON "Lease"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "LeasePosting_entryId_key" ON "LeasePosting"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "LeasePosting_leaseId_month_key" ON "LeasePosting"("leaseId", "month");

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_cancelEntryId_fkey" FOREIGN KEY ("cancelEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePosting" ADD CONSTRAINT "LeasePosting_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePosting" ADD CONSTRAINT "LeasePosting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Lease" ADD CONSTRAINT "Lease_term_check" CHECK ("months" > 12 AND "months" <= 600 AND "intervalMonths" IN (1, 3, 6, 12) AND "months" % "intervalMonths" = 0);
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_start_check" CHECK ("startMonth" BETWEEN 1 AND 12 AND "startYear" BETWEEN 2000 AND 2100);
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_amounts_check" CHECK ("payment" > 0 AND "rateBp" BETWEEN 0 AND 10000);
ALTER TABLE "LeasePosting" ADD CONSTRAINT "LeasePosting_month_check" CHECK ("month" >= 1);

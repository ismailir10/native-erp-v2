-- CreateEnum
CREATE TYPE "ProposalSource" AS ENUM ('AI_CONTROL', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'POSTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ProposedEntry" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "source" "ProposalSource" NOT NULL,
    "controlKey" TEXT,
    "key" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "bankTransactionId" TEXT,
    "entryId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposedEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProposedEntry_key_key" ON "ProposedEntry"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProposedEntry_entryId_key" ON "ProposedEntry"("entryId");

-- CreateIndex
CREATE INDEX "ProposedEntry_clientId_year_month_idx" ON "ProposedEntry"("clientId", "year", "month");

-- AddForeignKey
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A posted proposal always points at its entry, and a proposal's period is a real month (accounting-rules 20b).
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_posted_check" CHECK (("status" = 'POSTED') = ("entryId" IS NOT NULL));
ALTER TABLE "ProposedEntry" ADD CONSTRAINT "ProposedEntry_month_check" CHECK ("month" BETWEEN 1 AND 12);

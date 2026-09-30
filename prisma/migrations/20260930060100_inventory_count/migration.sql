-- Month-end stock count (stock opname) per entity, periodic method (accounting-rules 5i).
-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "bookBefore" BIGINT NOT NULL,
    "note" TEXT,
    "entryId" TEXT,
    "countedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryCount_clientId_idx" ON "InventoryCount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_entityId_year_month_key" ON "InventoryCount"("entityId", "year", "month");

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


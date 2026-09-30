-- A manual adjustment reversed line by line (Balik jurnal, accounting-rules 3a): the reversing entry points at it, once.
-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reversesId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversesId_key" ON "JournalEntry"("reversesId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


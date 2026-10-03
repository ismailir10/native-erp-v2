-- Receipts against notes (use-case UC-B5): a bank line's matched contact (its unmatched rest is that contact's advance), a voided
-- document (reversed, with its reason) and a customer's sales channel.
-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "channel" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "voidEntryId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_voidEntryId_key" ON "Invoice"("voidEntryId");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_voidEntryId_fkey" FOREIGN KEY ("voidEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_void_check" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL));

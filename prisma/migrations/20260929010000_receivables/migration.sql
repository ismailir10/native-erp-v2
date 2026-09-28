-- Receivable/payable subledger (cycle docs/cycles/2026-09-29-receivables-payables.md).
-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('SALES', 'PURCHASE');

-- AlterEnum
ALTER TYPE "EntryKind" ADD VALUE 'INVOICE';

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "dpp" BIGINT NOT NULL,
    "ppn" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "counterAccountId" TEXT NOT NULL,
    "arApAccountId" TEXT NOT NULL,
    "opening" BOOLEAN NOT NULL DEFAULT false,
    "entryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSettlement" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_clientId_name_key" ON "Contact"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_entryId_key" ON "Invoice"("entryId");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_contactId_idx" ON "Invoice"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_entityId_direction_number_key" ON "Invoice"("entityId", "direction", "number");

-- CreateIndex
CREATE INDEX "InvoiceSettlement_bankTransactionId_idx" ON "InvoiceSettlement"("bankTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSettlement_invoiceId_bankTransactionId_key" ON "InvoiceSettlement"("invoiceId", "bankTransactionId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_arApAccountId_fkey" FOREIGN KEY ("arApAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Subledger invariants (accounting-rules 5c).
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check" CHECK ("dpp" >= 0 AND "ppn" >= 0 AND "total" = "dpp" + "ppn" AND "total" > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_due_check" CHECK ("dueDate" >= "issueDate");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_opening_check" CHECK ("opening" = ("entryId" IS NULL));
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_amount_check" CHECK ("amount" > 0);

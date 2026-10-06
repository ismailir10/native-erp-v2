-- Scanned statements read by AI (I2a): drafts awaiting the accountant, proved by the running balance.
-- CreateTable
CREATE TABLE "OcrDraft" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "header" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "opening" TEXT,
    "closing" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "importId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrDraft_clientId_idx" ON "OcrDraft"("clientId");


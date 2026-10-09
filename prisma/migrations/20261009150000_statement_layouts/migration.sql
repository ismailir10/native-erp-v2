-- Atur kolom (cycle 2026-10-09-column-mapping): remembered statement layouts per firm, and how a Periksa baris draft was read. Additive.
ALTER TABLE "OcrDraft" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'OCR';

CREATE TABLE "StatementLayout" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "StatementLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StatementLayout_firmId_signature_key" ON "StatementLayout"("firmId", "signature");

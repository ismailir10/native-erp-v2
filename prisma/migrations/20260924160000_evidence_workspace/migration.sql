-- AlterEnum
ALTER TYPE "EntityKind" ADD VALUE IF NOT EXISTS 'BADAN_USAHA_ASING';

-- AlterTable
ALTER TABLE "StatementImport" ADD COLUMN     "evidenceUnitKey" TEXT,
ADD COLUMN     "evidenceVersionId" TEXT;

-- AlterTable
ALTER TABLE "LedgerImport" ADD COLUMN     "evidenceUnitKey" TEXT,
ADD COLUMN     "evidenceVersionId" TEXT;

-- CreateTable
CREATE TABLE "AiReservation" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AiReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveOAuthState" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceIntake" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "cursor" JSONB NOT NULL DEFAULT '{}',
    "issue" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "contextVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceDocument" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "remote" JSONB NOT NULL DEFAULT '{}',
    "fingerprint" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issue" TEXT,
    "seenRun" TEXT,

    CONSTRAINT "EvidenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceVersion" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "units" JSONB NOT NULL DEFAULT '[]',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "extracted" BOOLEAN NOT NULL DEFAULT false,
    "analyzed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePassage" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "EvidencePassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFact" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "effectiveDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',

    CONSTRAINT "EvidenceFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceConflict" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "versionIds" JSONB NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "EvidenceConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSelection" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "entityId" TEXT,
    "periodStart" TEXT,
    "periodEnd" TEXT,
    "currency" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "importId" TEXT,

    CONSTRAINT "EvidenceSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceUpload" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "receivedBytes" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceMessage" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "scope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReservation_firmId_at_idx" ON "AiReservation"("firmId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_firmId_key" ON "DriveConnection"("firmId");

-- CreateIndex
CREATE INDEX "EvidenceIntake_firmId_clientId_idx" ON "EvidenceIntake"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "EvidenceDocument_firmId_intakeId_idx" ON "EvidenceDocument"("firmId", "intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceDocument_intakeId_sourceKey_key" ON "EvidenceDocument"("intakeId", "sourceKey");

-- CreateIndex
CREATE INDEX "EvidenceVersion_firmId_idx" ON "EvidenceVersion"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersion_documentId_hash_key" ON "EvidenceVersion"("documentId", "hash");

-- CreateIndex
CREATE INDEX "EvidencePassage_firmId_versionId_idx" ON "EvidencePassage"("firmId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFact_intakeId_versionId_unitKey_key_value_key" ON "EvidenceFact"("intakeId", "versionId", "unitKey", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConflict_intakeId_key_key" ON "EvidenceConflict"("intakeId", "key");

-- CreateIndex
CREATE INDEX "EvidenceSelection_firmId_intakeId_idx" ON "EvidenceSelection"("firmId", "intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceSelection_versionId_unitKey_key" ON "EvidenceSelection"("versionId", "unitKey");

-- CreateIndex
CREATE INDEX "EvidenceUpload_firmId_intakeId_idx" ON "EvidenceUpload"("firmId", "intakeId");

-- AddForeignKey
ALTER TABLE "EvidenceDocument" ADD CONSTRAINT "EvidenceDocument_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "EvidenceIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceVersion" ADD CONSTRAINT "EvidenceVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidencePassage" ADD CONSTRAINT "EvidencePassage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EvidenceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFact" ADD CONSTRAINT "EvidenceFact_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "EvidenceIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConflict" ADD CONSTRAINT "EvidenceConflict_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "EvidenceIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMessage" ADD CONSTRAINT "EvidenceMessage_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "EvidenceIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Evidence search uses the simple dictionary for mixed Bahasa/English terms.
CREATE INDEX "EvidencePassage_text_search" ON "EvidencePassage" USING GIN (to_tsvector('simple', "text"));

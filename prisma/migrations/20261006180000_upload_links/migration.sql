-- Tautan unggah klien (I1d): secret, expiring, revocable upload-only links into one review inbox each.
-- CreateTable
CREATE TABLE "UploadLink" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadLink_intakeId_key" ON "UploadLink"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadLink_tokenHash_key" ON "UploadLink"("tokenHash");

-- CreateIndex
CREATE INDEX "UploadLink_clientId_idx" ON "UploadLink"("clientId");

-- AddForeignKey
ALTER TABLE "UploadLink" ADD CONSTRAINT "UploadLink_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "EvidenceIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;


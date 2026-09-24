CREATE TABLE "EvidenceAiCache" ("key" TEXT NOT NULL, "firmId" TEXT NOT NULL, "scope" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "EvidenceAiCache_pkey" PRIMARY KEY ("key"));
CREATE INDEX "EvidenceAiCache_firmId_scope_idx" ON "EvidenceAiCache"("firmId", "scope");

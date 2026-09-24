ALTER TABLE "EvidenceDocument" ADD COLUMN "approvedShortcutTarget" TEXT;
ALTER TABLE "EvidenceSelection" ADD COLUMN "bankAccountId" TEXT;
CREATE UNIQUE INDEX "StatementImport_evidenceVersionId_evidenceUnitKey_key" ON "StatementImport"("evidenceVersionId", "evidenceUnitKey");
CREATE UNIQUE INDEX "LedgerImport_evidenceVersionId_evidenceUnitKey_key" ON "LedgerImport"("evidenceVersionId", "evidenceUnitKey");

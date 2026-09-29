-- Tax pack (cycle docs/cycles/2026-09-29-tax-pack.md).
-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('NORMAL', 'FINAL_UMKM');

-- CreateEnum
CREATE TYPE "CorrectionDirection" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "CorrectionKind" AS ENUM ('PERMANENT', 'TEMPORARY');

-- CreateEnum
CREATE TYPE "TaxCreditType" AS ENUM ('PPH_22', 'PPH_23', 'PPH_24', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxPostingKind" AS ENUM ('CURRENT', 'DEFERRED');

-- CreateTable
CREATE TABLE "TaxYear" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "regime" "TaxRegime" NOT NULL DEFAULT 'NORMAL',
    "dismissedSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalCorrection" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "direction" "CorrectionDirection" NOT NULL,
    "kind" "CorrectionKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "accountId" TEXT,
    "suggestion" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCredit" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "type" "TaxCreditType" NOT NULL,
    "reference" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPosting" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "kind" "TaxPostingKind" NOT NULL,
    "entryId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxYear_clientId_idx" ON "TaxYear"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYear_entityId_year_key" ON "TaxYear"("entityId", "year");

-- CreateIndex
CREATE INDEX "FiscalCorrection_taxYearId_idx" ON "FiscalCorrection"("taxYearId");

-- CreateIndex
CREATE INDEX "TaxCredit_taxYearId_idx" ON "TaxCredit"("taxYearId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPosting_entryId_key" ON "TaxPosting"("entryId");

-- CreateIndex
CREATE INDEX "TaxPosting_taxYearId_idx" ON "TaxPosting"("taxYearId");

-- AddForeignKey
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCorrection" ADD CONSTRAINT "FiscalCorrection_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCorrection" ADD CONSTRAINT "FiscalCorrection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCorrection" ADD CONSTRAINT "FiscalCorrection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCredit" ADD CONSTRAINT "TaxCredit_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCredit" ADD CONSTRAINT "TaxCredit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCredit" ADD CONSTRAINT "TaxCredit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPosting" ADD CONSTRAINT "TaxPosting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Pack invariants (accounting-rules 5d).
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_year_check" CHECK ("year" >= 2000 AND "year" <= 2100);
ALTER TABLE "FiscalCorrection" ADD CONSTRAINT "FiscalCorrection_amount_check" CHECK ("amount" > 0);
ALTER TABLE "TaxCredit" ADD CONSTRAINT "TaxCredit_amount_check" CHECK ("amount" > 0);

-- Firm rule fix: a PPh 25 instalment is a prepayment credited against the year's tax, not an expense. Only the seeded rule changes;
-- rules the accountant wrote and lines already classified stay as they are.
UPDATE "Rule" SET "accountCode" = '1180' WHERE "clientId" IS NULL AND "source" = 'SEED' AND "pattern" = 'PPH 25' AND "accountCode" = '8100';

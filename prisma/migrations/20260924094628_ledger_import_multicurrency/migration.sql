-- CreateEnum
CREATE TYPE "MapMethod" AS ENUM ('PRIOR', 'NAME', 'KEYWORD', 'AI', 'MANUAL', 'NEW');

-- CreateEnum
CREATE TYPE "LedgerMode" AS ENUM ('LEDGER', 'NERACA');

-- CreateEnum
CREATE TYPE "CurrencyMode" AS ENUM ('FUNCTIONAL', 'CONVERT');

-- CreateEnum
CREATE TYPE "LedgerImportStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "CheckSeverity" AS ENUM ('BLOCK', 'REVIEW', 'INFO');

-- CreateEnum
CREATE TYPE "RateKind" AS ENUM ('SPOT', 'AVERAGE');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('MANUAL', 'FILE');

-- AlterEnum
ALTER TYPE "BankCode" ADD VALUE 'SMBC';

-- AlterEnum
ALTER TYPE "EntryKind" ADD VALUE 'IMPORTED';

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'IDR',
ADD COLUMN     "isOverdraft" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "functionalCurrency" TEXT NOT NULL DEFAULT 'IDR';

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "ledgerImportId" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxAmount" BIGINT,
ADD COLUMN     "fxRate" TEXT,
ADD COLUMN     "sourceAccountId" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- CreateTable
CREATE TABLE "SourceAccount" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "previousNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typeHint" "AccountType",
    "currency" TEXT,
    "accountId" TEXT,
    "mappedBy" "MapMethod",
    "mapConfidence" DOUBLE PRECISION,
    "mapReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerImport" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currencyMode" "CurrencyMode" NOT NULL DEFAULT 'FUNCTIONAL',
    "status" "LedgerImportStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "roundingTotal" BIGINT NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "LedgerImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportCheck" (
    "id" TEXT NOT NULL,
    "ledgerImportId" TEXT NOT NULL,
    "severity" "CheckSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityId" TEXT,
    "date" DATE,
    "amount" BIGINT,
    "accepted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ImportCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "RateKind" NOT NULL DEFAULT 'SPOT',
    "rate" TEXT NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceAccount_clientId_idx" ON "SourceAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAccount_entityId_code_key" ON "SourceAccount"("entityId", "code");

-- CreateIndex
CREATE INDEX "LedgerImport_clientId_fileHash_idx" ON "LedgerImport"("clientId", "fileHash");

-- CreateIndex
CREATE INDEX "ImportCheck_ledgerImportId_idx" ON "ImportCheck"("ledgerImportId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_firmId_currency_quote_date_kind_key" ON "ExchangeRate"("firmId", "currency", "quote", "date", "kind");

-- CreateIndex
CREATE INDEX "JournalEntry_ledgerImportId_idx" ON "JournalEntry"("ledgerImportId");

-- CreateIndex
CREATE INDEX "JournalLine_sourceAccountId_idx" ON "JournalLine"("sourceAccountId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_ledgerImportId_fkey" FOREIGN KEY ("ledgerImportId") REFERENCES "LedgerImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "SourceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerImport" ADD CONSTRAINT "LedgerImport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportCheck" ADD CONSTRAINT "ImportCheck_ledgerImportId_fkey" FOREIGN KEY ("ledgerImportId") REFERENCES "LedgerImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign-currency line integrity (rule 6b): fx fields come together and the fx amount is unsigned like debit/credit.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_fx_check"
  CHECK (("fxAmount" IS NULL AND "currency" IS NULL AND "fxRate" IS NULL)
      OR ("fxAmount" IS NOT NULL AND "fxAmount" >= 0 AND "currency" IS NOT NULL AND "fxRate" IS NOT NULL));

-- New template accounts (lib/coa/template.ts) for clients created before this migration.
INSERT INTO "Account" ("id", "firmId", "clientId", "code", "name", "type", "normalBalance", "fsLine")
SELECT gen_random_uuid()::text, c."firmId", c."id", t.code, t.name, t.type::"AccountType", t.nb::"NormalBalance", t.fs
FROM "Client" c
CROSS JOIN (VALUES
  ('3900', 'Selisih Penjabaran Mata Uang Asing', 'EKUITAS', 'CREDIT', 'SELISIH_PENJABARAN'),
  ('7190', 'Selisih Pembulatan', 'BEBAN', 'DEBIT', 'BEBAN_LAIN'),
  ('7200', 'Laba/Rugi Selisih Kurs', 'BEBAN', 'DEBIT', 'BEBAN_LAIN')
) AS t(code, name, type, nb, fs)
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."clientId" = c."id" AND a."code" = t.code);

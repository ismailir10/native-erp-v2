-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('PT', 'CV', 'PERORANGAN');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASET', 'LIABILITAS', 'EKUITAS', 'PENDAPATAN', 'BEBAN');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TaxTag" AS ENUM ('PPN_KELUARAN', 'PPN_MASUKAN', 'PPH_21', 'PPH_23', 'PPH_4_2', 'PPH_25');

-- CreateEnum
CREATE TYPE "BankCode" AS ENUM ('BCA', 'MANDIRI', 'BRI', 'GENERIC');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('POSTED', 'NEEDS_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "ClassifyMethod" AS ENUM ('TRANSFER', 'RULE', 'MEMORY', 'AI', 'HEURISTIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('OPENING', 'BANK', 'RECLASS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coaVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "npwp" TEXT,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "normalBalance" "NormalBalance" NOT NULL,
    "fsLine" TEXT NOT NULL,
    "isBank" BOOLEAN NOT NULL DEFAULT false,
    "isIntercompany" BOOLEAN NOT NULL DEFAULT false,
    "isClearing" BOOLEAN NOT NULL DEFAULT false,
    "isSuspense" BOOLEAN NOT NULL DEFAULT false,
    "isRetained" BOOLEAN NOT NULL DEFAULT false,
    "taxTag" "TaxTag",

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bank" "BankCode" NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Period" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "lockedAt" TIMESTAMP(3),
    "lockNote" TEXT,

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" "BankCode" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalance" BIGINT NOT NULL,
    "closingBalance" BIGINT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "continuityOk" BOOLEAN NOT NULL,
    "continuityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance" BIGINT,
    "rowNumber" INTEGER NOT NULL,
    "rawRow" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL,
    "method" "ClassifyMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "accountCode" TEXT,
    "suggestedCode" TEXT,
    "taxTag" "TaxTag",
    "matchedTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "memo" TEXT NOT NULL,
    "bankTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT,
    "pattern" TEXT NOT NULL,
    "direction" "Direction",
    "accountCode" TEXT NOT NULL,
    "taxTag" "TaxTag",
    "priority" INTEGER NOT NULL DEFAULT 100,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "accountCode" TEXT NOT NULL,
    "taxTag" "TaxTag",
    "hits" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "accountCode" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "taxTag" "TaxTag",
    "reason" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "keysRequested" INTEGER NOT NULL,
    "cacheHits" INTEGER NOT NULL,
    "calls" INTEGER NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "note" TEXT,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlAck" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "controlKey" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseSignoff" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloseSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_firmId_idx" ON "Client"("firmId");

-- CreateIndex
CREATE INDEX "Entity_clientId_idx" ON "Entity"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_clientId_code_key" ON "Account"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_entityId_number_key" ON "BankAccount"("entityId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Period_clientId_year_month_key" ON "Period"("clientId", "year", "month");

-- CreateIndex
CREATE INDEX "BankTransaction_entityId_date_idx" ON "BankTransaction"("entityId", "date");

-- CreateIndex
CREATE INDEX "BankTransaction_status_idx" ON "BankTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_hash_key" ON "BankTransaction"("bankAccountId", "hash");

-- CreateIndex
CREATE INDEX "JournalEntry_entityId_date_idx" ON "JournalEntry"("entityId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_bankTransactionId_idx" ON "JournalEntry"("bankTransactionId");

-- CreateIndex
CREATE INDEX "JournalLine_entityId_accountId_date_idx" ON "JournalLine"("entityId", "accountId", "date");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_clientId_merchantKey_direction_key" ON "Memory"("clientId", "merchantKey", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "AiSuggestion_cacheKey_key" ON "AiSuggestion"("cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "ControlAck_periodId_controlKey_key" ON "ControlAck"("periodId", "controlKey");

-- CreateIndex
CREATE UNIQUE INDEX "CloseSignoff_periodId_key_key" ON "CloseSignoff"("periodId", "key");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Period" ADD CONSTRAINT "Period_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "StatementImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlAck" ADD CONSTRAINT "ControlAck_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseSignoff" ADD CONSTRAINT "CloseSignoff_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Double-entry guards (accounting-rules invariant #2)
ALTER TABLE "JournalLine" ADD CONSTRAINT "journal_line_non_negative" CHECK ("debit" >= 0 AND "credit" >= 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT "journal_line_one_side" CHECK (("debit" = 0) <> ("credit" = 0));

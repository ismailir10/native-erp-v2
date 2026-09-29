-- Employee benefits PSAK 24 (cycle docs/cycles/2026-09-29-employee-benefits-psak24.md).
-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateTable
CREATE TABLE "MortalityTable" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "male" INTEGER[],
    "female" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MortalityTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeNo" TEXT,
    "sex" "Sex" NOT NULL,
    "birthDate" DATE NOT NULL,
    "hireDate" DATE NOT NULL,
    "wage" BIGINT NOT NULL,
    "leftOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitSetting" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "mortalityTableId" TEXT,
    "discountBp" INTEGER NOT NULL,
    "salaryBp" INTEGER NOT NULL,
    "retirementAge" INTEGER NOT NULL DEFAULT 56,
    "disabilityBp" INTEGER NOT NULL DEFAULT 1000,
    "resignBp" INTEGER NOT NULL DEFAULT 500,
    "resignFlatUntil" INTEGER NOT NULL DEFAULT 30,
    "resignZeroAge" INTEGER NOT NULL DEFAULT 55,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitPosting" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "entryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitPosting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MortalityTable_firmId_name_key" ON "MortalityTable"("firmId", "name");

-- CreateIndex
CREATE INDEX "Employee_clientId_idx" ON "Employee"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_entityId_employeeNo_key" ON "Employee"("entityId", "employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitSetting_entityId_key" ON "BenefitSetting"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitPosting_entryId_key" ON "BenefitPosting"("entryId");

-- CreateIndex
CREATE INDEX "BenefitPosting_entityId_idx" ON "BenefitPosting"("entityId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitSetting" ADD CONSTRAINT "BenefitSetting_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitSetting" ADD CONSTRAINT "BenefitSetting_mortalityTableId_fkey" FOREIGN KEY ("mortalityTableId") REFERENCES "MortalityTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitPosting" ADD CONSTRAINT "BenefitPosting_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitPosting" ADD CONSTRAINT "BenefitPosting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Employee" ADD CONSTRAINT "Employee_dates_check" CHECK ("hireDate" > "birthDate" AND ("leftOn" IS NULL OR "leftOn" >= "hireDate"));
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_wage_check" CHECK ("wage" > 0);
ALTER TABLE "BenefitSetting" ADD CONSTRAINT "BenefitSetting_rates_check" CHECK ("discountBp" BETWEEN 0 AND 3000 AND "salaryBp" BETWEEN 0 AND 3000 AND "disabilityBp" BETWEEN 0 AND 10000 AND "resignBp" BETWEEN 0 AND 10000);
ALTER TABLE "BenefitSetting" ADD CONSTRAINT "BenefitSetting_ages_check" CHECK ("retirementAge" BETWEEN 45 AND 70 AND "resignFlatUntil" BETWEEN 15 AND "resignZeroAge" AND "resignZeroAge" <= "retirementAge");
ALTER TABLE "MortalityTable" ADD CONSTRAINT "MortalityTable_ages_check" CHECK (cardinality("male") >= 100 AND cardinality("male") = cardinality("female"));
ALTER TABLE "BenefitPosting" ADD CONSTRAINT "BenefitPosting_month_check" CHECK ("month" BETWEEN 1 AND 12);

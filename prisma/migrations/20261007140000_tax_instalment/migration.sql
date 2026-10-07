-- PPh 25 angsuran per bulan from a masa onward (rule 5j), typed by the accountant.
-- CreateTable
CREATE TABLE "TaxInstalment" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxInstalment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxInstalment_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "TaxInstalment_from_check" CHECK (EXTRACT(DAY FROM "from") = 1)
);

-- CreateIndex
CREATE INDEX "TaxInstalment_clientId_idx" ON "TaxInstalment"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInstalment_entityId_from_key" ON "TaxInstalment"("entityId", "from");

-- Ekualisasi PPN (I5c): faktur read from a Coretax export, evidence only (never posted).
-- CreateTable
CREATE TABLE "CoretaxFaktur" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "npwp" TEXT,
    "name" TEXT NOT NULL,
    "dpp" BIGINT NOT NULL,
    "ppn" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "uncredited" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoretaxFaktur_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoretaxFaktur_direction_check" CHECK ("direction" IN ('KELUARAN', 'MASUKAN')),
    CONSTRAINT "CoretaxFaktur_month_check" CHECK ("month" BETWEEN 1 AND 12)
);

-- CreateIndex
CREATE INDEX "CoretaxFaktur_clientId_idx" ON "CoretaxFaktur"("clientId");

-- CreateIndex
CREATE INDEX "CoretaxFaktur_entityId_year_month_idx" ON "CoretaxFaktur"("entityId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CoretaxFaktur_entityId_direction_number_key" ON "CoretaxFaktur"("entityId", "direction", "number");

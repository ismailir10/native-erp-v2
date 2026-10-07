-- Bukti potong Unifikasi (I5d): slips read from a Coretax export, evidence only (never posted).
-- CreateTable
CREATE TABLE "CoretaxBupot" (
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
    "kop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dpp" BIGINT NOT NULL,
    "pph" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoretaxBupot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoretaxBupot_direction_check" CHECK ("direction" IN ('DIBUAT', 'DITERIMA')),
    CONSTRAINT "CoretaxBupot_kind_check" CHECK ("kind" IN ('PPH_23', 'PPH_4_2', 'PPH_22', 'PPH_26', 'LAINNYA')),
    CONSTRAINT "CoretaxBupot_month_check" CHECK ("month" BETWEEN 1 AND 12)
);

-- CreateIndex
CREATE INDEX "CoretaxBupot_clientId_idx" ON "CoretaxBupot"("clientId");

-- CreateIndex
CREATE INDEX "CoretaxBupot_entityId_year_month_idx" ON "CoretaxBupot"("entityId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CoretaxBupot_entityId_direction_number_key" ON "CoretaxBupot"("entityId", "direction", "number");

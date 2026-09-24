-- AlterTable
ALTER TABLE "SourceAccount" ADD COLUMN     "suggestedBy" "MapMethod",
ADD COLUMN     "suggestedCode" TEXT;

-- CreateTable
CREATE TABLE "AiAccountMap" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typeHint" TEXT,
    "accountCode" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAccountMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAccountMap_cacheKey_key" ON "AiAccountMap"("cacheKey");

-- Generic template accounts for ledger imports (lib/coa/template.ts) for clients created before this migration.
INSERT INTO "Account" ("id", "firmId", "clientId", "code", "name", "type", "normalBalance", "fsLine")
SELECT gen_random_uuid()::text, c."firmId", c."id", t.code, t.name, t.type::"AccountType", t.nb::"NormalBalance", t.fs
FROM "Client" c
CROSS JOIN (VALUES
  ('1120', 'Kas di Bank (Buku Besar)', 'ASET', 'DEBIT', 'KAS_SETARA_KAS'),
  ('1140', 'Piutang Lain-lain', 'ASET', 'DEBIT', 'PIUTANG_LAIN'),
  ('1180', 'Pajak Dibayar di Muka', 'ASET', 'DEBIT', 'PAJAK_DIBAYAR_DIMUKA'),
  ('1250', 'Aset Tak Berwujud & Hak Guna', 'ASET', 'DEBIT', 'ASET_TIDAK_LANCAR_LAIN'),
  ('1260', 'Investasi & Aset Tidak Lancar Lain', 'ASET', 'DEBIT', 'ASET_TIDAK_LANCAR_LAIN'),
  ('2120', 'Utang Lain-lain', 'LIABILITAS', 'CREDIT', 'UTANG_LAIN'),
  ('2145', 'Utang Pajak Lainnya', 'LIABILITAS', 'CREDIT', 'UTANG_PAJAK'),
  ('2160', 'Pendapatan Diterima di Muka', 'LIABILITAS', 'CREDIT', 'UTANG_LAIN'),
  ('2300', 'Utang Jangka Panjang', 'LIABILITAS', 'CREDIT', 'UTANG_JANGKA_PANJANG'),
  ('2310', 'Liabilitas Imbalan Kerja', 'LIABILITAS', 'CREDIT', 'UTANG_JANGKA_PANJANG'),
  ('3110', 'Tambahan Modal Disetor', 'EKUITAS', 'CREDIT', 'MODAL')
) AS t(code, name, type, nb, fs)
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."clientId" = c."id" AND a."code" = t.code);

-- Tahun buku per klien (use-case feedback: Chickin closes on 31 January). 12 = calendar year; reports count "the year" from the
-- month after the end month (lib/fiscal.ts). Nothing posted depends on it.
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "fiscalYearEndMonth" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Client" ADD CONSTRAINT "Client_fiscalYearEndMonth_check" CHECK ("fiscalYearEndMonth" BETWEEN 1 AND 12);

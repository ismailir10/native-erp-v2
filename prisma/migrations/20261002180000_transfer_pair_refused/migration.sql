-- A bank line the reviewer took out of a transfer pair (Lepas pasangan) is never paired again by the matcher (UC-B2).
-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "pairRefused" BOOLEAN NOT NULL DEFAULT false;

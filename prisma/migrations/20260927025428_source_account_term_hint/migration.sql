-- CreateEnum
CREATE TYPE "AccountTerm" AS ENUM ('CURRENT', 'NON_CURRENT');

-- AlterTable
ALTER TABLE "SourceAccount" ADD COLUMN     "termHint" "AccountTerm";

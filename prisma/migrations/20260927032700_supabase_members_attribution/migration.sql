-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'AKUNTAN');

-- DropForeignKey
ALTER TABLE "AuthAccount" DROP CONSTRAINT "AuthAccount_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "AuthUser" DROP CONSTRAINT "AuthUser_firmId_fkey";

-- AlterTable
ALTER TABLE "CloseSignoff" ADD COLUMN     "doneById" TEXT;

-- AlterTable
ALTER TABLE "ControlAck" ADD COLUMN     "ackedById" TEXT;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "postedById" TEXT;

-- AlterTable
ALTER TABLE "LedgerImport" ADD COLUMN     "importedById" TEXT,
ADD COLUMN     "postedById" TEXT;

-- AlterTable
ALTER TABLE "Period" ADD COLUMN     "lockedById" TEXT;

-- AlterTable
ALTER TABLE "SourceAccount" ADD COLUMN     "mappedById" TEXT;

-- AlterTable
ALTER TABLE "StatementImport" ADD COLUMN     "importedById" TEXT;

-- DropTable
DROP TABLE "AuthAccount";

-- DropTable
DROP TABLE "AuthRateLimit";

-- DropTable
DROP TABLE "AuthSession";

-- DropTable
DROP TABLE "AuthUser";

-- DropTable
DROP TABLE "AuthVerification";

-- CreateTable
CREATE TABLE "FirmMember" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'AKUNTAN',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FirmMember_userId_key" ON "FirmMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FirmMember_email_key" ON "FirmMember"("email");

-- CreateIndex
CREATE INDEX "FirmMember_firmId_idx" ON "FirmMember"("firmId");

-- AddForeignKey
ALTER TABLE "Period" ADD CONSTRAINT "Period_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlAck" ADD CONSTRAINT "ControlAck_ackedById_fkey" FOREIGN KEY ("ackedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseSignoff" ADD CONSTRAINT "CloseSignoff_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerImport" ADD CONSTRAINT "LedgerImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerImport" ADD CONSTRAINT "LedgerImport_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "FirmMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmMember" ADD CONSTRAINT "FirmMember_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

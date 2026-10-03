-- Pecah transaksi (use-case UC-B3): a bank line's classification side split across accounts. The parts add up to the line's amount
-- (checked by lib/review.ts splitTransaction); each is a positive magnitude whose side follows the line.
-- CreateTable
CREATE TABLE "BankTxSplit" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTxSplit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BankTxSplit_amount_check" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTxSplit_bankTransactionId_position_key" ON "BankTxSplit"("bankTransactionId", "position");

-- AddForeignKey
ALTER TABLE "BankTxSplit" ADD CONSTRAINT "BankTxSplit_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

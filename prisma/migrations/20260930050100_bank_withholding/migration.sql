-- Tax withheld from a bank payment or receipt (PPh 21, 22, 23, 4(2)): the classification side of the line's journal carries a tax leg
-- (receipts: prepaid 1180 / final 8200; payments: 2140 / 2141 / 2145). Additive: existing lines keep no withholding.
CREATE TYPE "WithholdingKind" AS ENUM ('PPH_21', 'PPH_22', 'PPH_23', 'PPH_4_2');
ALTER TABLE "BankTransaction" ADD COLUMN "whtKind" "WithholdingKind";
ALTER TABLE "BankTransaction" ADD COLUMN "whtAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_whtAmount_check" CHECK ("whtAmount" >= 0 AND ("whtAmount" = 0) = ("whtKind" IS NULL));

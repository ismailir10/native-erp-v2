-- Withholding on invoices: the tax the counterparty withholds (expected, on the DPP) and, per settlement, the part of what it clears
-- that was paid as tax rather than cash. Additive: existing invoices and settlements keep 0 (nothing withheld).
ALTER TABLE "Invoice" ADD COLUMN "whtKind" "WithholdingKind";
ALTER TABLE "Invoice" ADD COLUMN "whtAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_whtAmount_check" CHECK ("whtAmount" >= 0 AND ("whtAmount" = 0) = ("whtKind" IS NULL));
ALTER TABLE "InvoiceSettlement" ADD COLUMN "withheld" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceSettlement" ADD CONSTRAINT "InvoiceSettlement_withheld_check" CHECK ("withheld" >= 0 AND "withheld" <= "amount");

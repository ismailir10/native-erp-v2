-- Masa pajak of a PPh 25 instalment: the tax pack credits an instalment to the year of its masa, not of its payment date (December's is
-- paid by 15 January). Nullable and not backfilled: a line without one keeps counting by its bank date, so existing numbers do not move.
ALTER TABLE "BankTransaction" ADD COLUMN "taxMonth" DATE;

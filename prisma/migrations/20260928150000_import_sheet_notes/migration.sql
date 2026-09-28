-- Workbook statements: the sheet each bank row came from, and the parser's notes on the import.
ALTER TABLE "BankTransaction" ADD COLUMN "sourceSheet" TEXT;
ALTER TABLE "StatementImport" ADD COLUMN "parseNotes" TEXT[] DEFAULT ARRAY[]::TEXT[];

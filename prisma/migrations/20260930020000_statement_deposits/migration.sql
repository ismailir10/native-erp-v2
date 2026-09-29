-- Time deposits listed on a statement (SMBC "Detail Produk Deposito"), offered in Saldo Awal.
ALTER TABLE "StatementImport" ADD COLUMN "deposits" JSONB NOT NULL DEFAULT '[]';

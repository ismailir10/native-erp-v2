-- PPh 21 TER check (I4c, accounting-rules 5j): an employee's PTKP status, optional.
CREATE TYPE "PtkpStatus" AS ENUM ('TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3');
ALTER TABLE "Employee" ADD COLUMN "ptkpStatus" "PtkpStatus";

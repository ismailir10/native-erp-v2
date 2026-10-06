-- Modules a client turned on in its menu (ADR 0014 §2, I1b). Presentation only; a module with data shows regardless.
ALTER TABLE "Client" ADD COLUMN "modules" TEXT[] DEFAULT ARRAY[]::TEXT[];

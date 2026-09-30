-- Reporting framework per entity (wording of the CALK / statements only). Additive: every existing entity becomes SAK_EP,
-- the standard the notes always named, so its output does not change.
-- Rollback: ALTER TABLE "Entity" DROP COLUMN "reportingFramework"; DROP TYPE "ReportingFramework";
CREATE TYPE "ReportingFramework" AS ENUM ('SAK_EMKM', 'SAK_EP', 'SAK_UMUM');
ALTER TABLE "Entity" ADD COLUMN "reportingFramework" "ReportingFramework" NOT NULL DEFAULT 'SAK_EP';

-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('KANTOR_AKUNTAN', 'PERUSAHAAN');

-- CreateEnum
CREATE TYPE "GrantKind" AS ENUM ('TRIAL', 'PAID', 'COMP');

-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupportViewKind" AS ENUM ('VIEW', 'EXPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MemberRole" ADD VALUE 'OWNER';
ALTER TYPE "MemberRole" ADD VALUE 'VIEWER';

-- AlterTable
ALTER TABLE "Firm" ADD COLUMN     "aiMonthlyTokenBudget" INTEGER,
ADD COLUMN     "kind" "OrgKind" NOT NULL DEFAULT 'KANTOR_AKUNTAN',
ADD COLUMN     "seatLimit" INTEGER,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "kind" "GrantKind" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "grantedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAccess" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "orgKind" "OrgKind" NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "status" "SignupStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "firmId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupThrottle" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "SignupThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "firmId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "asMemberId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSessionView" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" "SupportViewKind" NOT NULL DEFAULT 'VIEW',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportSessionView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessGrant_firmId_idx" ON "AccessGrant"("firmId");

-- CreateIndex
CREATE INDEX "ClientAccess_clientId_idx" ON "ClientAccess"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccess_memberId_clientId_key" ON "ClientAccess"("memberId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "SignupRequest_status_createdAt_idx" ON "SignupRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SignupRequest_email_idx" ON "SignupRequest"("email");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_firmId_createdAt_idx" ON "PlatformAuditEvent"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportSession_firmId_startedAt_idx" ON "SupportSession"("firmId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportSession_adminId_startedAt_idx" ON "SupportSession"("adminId", "startedAt");

-- CreateIndex
CREATE INDEX "SupportSessionView_sessionId_at_idx" ON "SupportSessionView"("sessionId", "at");

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccess" ADD CONSTRAINT "ClientAccess_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FirmMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccess" ADD CONSTRAINT "ClientAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAuditEvent" ADD CONSTRAINT "PlatformAuditEvent_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_asMemberId_fkey" FOREIGN KEY ("asMemberId") REFERENCES "FirmMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSessionView" ADD CONSTRAINT "SupportSessionView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SupportSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trial access, tenants and roles (cycle 2026-10-09-trial-tenants-roles, ADR 0017). Additive; the backfill is the next migration
-- because a new enum value cannot be used in the transaction that adds it.

ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_period_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_revoked_check" CHECK ("revokedById" IS NULL OR "revokedAt" IS NOT NULL);
ALTER TABLE "Firm" ADD CONSTRAINT "Firm_seatLimit_check" CHECK ("seatLimit" IS NULL OR "seatLimit" >= 1);
ALTER TABLE "Firm" ADD CONSTRAINT "Firm_aiMonthlyTokenBudget_check" CHECK ("aiMonthlyTokenBudget" IS NULL OR "aiMonthlyTokenBudget" >= 0);
-- A support session is bounded: at most 60 minutes from its start.
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_bounded_check" CHECK ("expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + interval '60 minutes');
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_reason_check" CHECK (length(btrim("reason")) >= 10);

-- Buku's own records of what its admins did are append-only. The one update let through on the audit log is the foreign key's
-- ON DELETE SET NULL; on a support session, only ending it (endedAt from null to a time).
CREATE FUNCTION "platform_audit_no_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."adminId" IS NOT NULL AND NEW."adminId" IS NULL AND (to_jsonb(NEW) - 'adminId') = (to_jsonb(OLD) - 'adminId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PlatformAuditEvent is append-only';
END;
$$;
CREATE TRIGGER "PlatformAuditEvent_no_change" BEFORE UPDATE OR DELETE ON "PlatformAuditEvent" FOR EACH ROW EXECUTE FUNCTION "platform_audit_no_change"();

CREATE FUNCTION "support_session_only_end"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."endedAt" IS NULL AND NEW."endedAt" IS NOT NULL AND (to_jsonb(NEW) - 'endedAt') = (to_jsonb(OLD) - 'endedAt') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SupportSession is append-only (only ending it is allowed)';
END;
$$;
CREATE TRIGGER "SupportSession_only_end" BEFORE UPDATE OR DELETE ON "SupportSession" FOR EACH ROW EXECUTE FUNCTION "support_session_only_end"();

CREATE FUNCTION "support_view_no_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SupportSessionView is append-only';
END;
$$;
CREATE TRIGGER "SupportSessionView_no_change" BEFORE UPDATE OR DELETE ON "SupportSessionView" FOR EACH ROW EXECUTE FUNCTION "support_view_no_change"();

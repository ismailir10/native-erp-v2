-- Backfill for trial access (cycle 2026-10-09-trial-tenants-roles, M1): what existed before grants keeps working unchanged.

-- 1. Every existing organisation keeps unlimited access: one open-ended COMP grant from its creation.
INSERT INTO "AccessGrant" ("id", "firmId", "kind", "startsAt", "endsAt", "note")
SELECT 'grant_' || replace(gen_random_uuid()::text, '-', ''), f."id", 'COMP', f."createdAt", NULL, 'Akses sejak sebelum masa uji coba (ADR 0017)'
FROM "Firm" f
WHERE NOT EXISTS (SELECT 1 FROM "AccessGrant" g WHERE g."firmId" = f."id");

-- 2. No role is rewritten here: FirmMember is a protected table (tests/unit/migration-protected-tables.test.ts). Existing ADMINs keep
--    ADMIN, which can do everything but transfer ownership; the operator names the first OWNER once with
--    `npm run access -- set-role --firm ID --email ADDRESS --role OWNER` (Ship Notes).

-- 3. Every AKUNTAN keeps seeing every client of its organisation.
INSERT INTO "ClientAccess" ("id", "memberId", "clientId")
SELECT 'ca_' || replace(gen_random_uuid()::text, '-', ''), m."id", c."id"
FROM "FirmMember" m JOIN "Client" c ON c."firmId" = m."firmId"
WHERE m."role" = 'AKUNTAN'
ON CONFLICT ("memberId", "clientId") DO NOTHING;

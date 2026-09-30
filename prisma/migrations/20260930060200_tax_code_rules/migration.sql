-- Firm starter rules for tax payments printed with their KAP-KJS code (FIRM_RULES in lib/classify/rules.ts): the state receipt names
-- the tax, so the payment files to the liability it clears. New firms get them at creation; existing firms get each one they don't
-- already have (same firm-wide pattern + direction). Lines already classified stay as they are.
INSERT INTO "Rule" ("id", "firmId", "clientId", "pattern", "direction", "accountCode", "taxTag", "priority", "source", "createdAt")
SELECT 'seed_' || md5(f."id" || ':' || v.pattern || ':' || v.direction), f."id", NULL, v.pattern, v.direction::"Direction", v.code,
       v.tax::"TaxTag", v.priority, 'SEED', CURRENT_TIMESTAMP
FROM "Firm" f
CROSS JOIN (VALUES
  ('411121', 'OUT', '2140', 'PPH_21', 12),
  ('411124', 'OUT', '2141', 'PPH_23', 12),
  ('411128', 'OUT', '2145', 'PPH_4_2', 12),
  ('411125-100', 'OUT', '1180', 'PPH_25', 12),
  ('411125100', 'OUT', '1180', 'PPH_25', 12),
  ('411125-200', 'OUT', '2146', NULL, 12),
  ('411125200', 'OUT', '2146', NULL, 12),
  ('411211', 'OUT', '2130', 'PPN_KELUARAN', 12)
) AS v(pattern, direction, code, tax, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM "Rule" r
  WHERE r."firmId" = f."id" AND r."clientId" IS NULL AND upper(r."pattern") = v.pattern AND r."direction"::text = v.direction
);

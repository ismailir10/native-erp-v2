-- Firm starter rules for bank interest, fees and stamp duty as SMBC and BCA print them (FIRM_RULES in lib/classify/rules.ts).
-- New firms get them at creation; existing firms get each one they don't already have as a firm rule with the same pattern and
-- direction. Lines already classified stay as they are.
INSERT INTO "Rule" ("id", "firmId", "clientId", "pattern", "direction", "accountCode", "taxTag", "priority", "source", "createdAt")
SELECT 'seed_' || md5(f."id" || ':' || v.pattern || ':' || v.direction), f."id", NULL, v.pattern, v.direction::"Direction", v.code,
       v.tax::"TaxTag", v.priority, 'SEED', CURRENT_TIMESTAMP
FROM "Firm" f
CROSS JOIN (VALUES
  ('TAX ON INTEREST', 'OUT', '8200', 'PPH_4_2', 10),
  ('INTEREST', 'IN', '4900', NULL, 20),
  ('BUNGA', 'OUT', '7110', NULL, 20),
  ('INTEREST', 'OUT', '7110', NULL, 20),
  ('BIAYA TXN', 'OUT', '7100', NULL, 20),
  ('FEE PAYMENT', 'OUT', '7100', NULL, 20),
  ('MATERAI', 'OUT', '7100', NULL, 20),
  ('STAMP DUTY', 'OUT', '7100', NULL, 20)
) AS v(pattern, direction, code, tax, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM "Rule" r
  WHERE r."firmId" = f."id" AND r."clientId" IS NULL AND upper(r."pattern") = v.pattern AND r."direction"::text = v.direction
);

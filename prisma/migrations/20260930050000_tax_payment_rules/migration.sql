-- Firm starter rules for tax remittances (FIRM_RULES in lib/classify/rules.ts). A remittance clears the liability booked when the tax was
-- withheld; PPh 21 paid in January for December no longer lands in salary expense. New firms get them at creation; existing firms get
-- each one they don't already have (same firm-wide pattern + direction), and their own untouched seed rule PPH 21 moves from 6100 to 2140.
-- Lines already classified stay as they are. A rule whose account a client's chart lacks is skipped at import time.
UPDATE "Rule" SET "accountCode" = '2140'
WHERE "clientId" IS NULL AND "source" = 'SEED' AND upper("pattern") = 'PPH 21' AND "direction"::text = 'OUT' AND "accountCode" = '6100';

INSERT INTO "Rule" ("id", "firmId", "clientId", "pattern", "direction", "accountCode", "taxTag", "priority", "source", "createdAt")
SELECT 'seed_' || md5(f."id" || ':' || v.pattern || ':' || v.direction), f."id", NULL, v.pattern, v.direction::"Direction", v.code,
       v.tax::"TaxTag", v.priority, 'SEED', CURRENT_TIMESTAMP
FROM "Firm" f
CROSS JOIN (VALUES
  ('SETOR PPN', 'OUT', '2130', 'PPN_KELUARAN', 15),
  ('PAJAK PPN', 'OUT', '2130', 'PPN_KELUARAN', 15),
  ('PPN MASA', 'OUT', '2130', 'PPN_KELUARAN', 15),
  ('PPH 21', 'OUT', '2140', 'PPH_21', 15),
  ('PPH21', 'OUT', '2140', 'PPH_21', 15),
  ('PPH PASAL 21', 'OUT', '2140', 'PPH_21', 15),
  ('PPH 23', 'OUT', '2141', 'PPH_23', 15),
  ('PPH23', 'OUT', '2141', 'PPH_23', 15),
  ('PPH PASAL 23', 'OUT', '2141', 'PPH_23', 15),
  ('PPH 4(2)', 'OUT', '2145', 'PPH_4_2', 15),
  ('PPH 4 (2)', 'OUT', '2145', 'PPH_4_2', 15),
  ('PPH 4 AYAT 2', 'OUT', '2145', 'PPH_4_2', 15),
  ('PPH PASAL 4', 'OUT', '2145', 'PPH_4_2', 15),
  ('PPH FINAL', 'OUT', '2145', 'PPH_4_2', 15),
  ('PPH 29', 'OUT', '2146', NULL, 15),
  ('PPH29', 'OUT', '2146', NULL, 15),
  ('PPH 25', 'OUT', '1180', 'PPH_25', 15),
  ('PPH25', 'OUT', '1180', 'PPH_25', 15),
  ('METERAI', 'OUT', '7100', NULL, 20)
) AS v(pattern, direction, code, tax, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM "Rule" r
  WHERE r."firmId" = f."id" AND r."clientId" IS NULL AND upper(r."pattern") = v.pattern AND r."direction"::text = v.direction
);

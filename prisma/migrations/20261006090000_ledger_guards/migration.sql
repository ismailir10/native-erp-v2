-- Ledger guards (accounting-rules 2–4, cycle 2026-10-06 I0): the database itself refuses what postJournal() refuses, so a bug or a
-- script that writes around it can't leave an unbalanced entry, change a locked month or rewrite a posted amount.
--   balanced      deferred constraint triggers: at commit every entry has ≥ 2 lines and Σdebit = Σcredit
--   locked month  inserting or deleting an entry or line dated in a LOCKED period of its client is refused; the one bypass is deleting a
--                 whole client (lib/clients/delete.ts sets buku.client_delete = 'on' for its own transaction only)
--   immutable     a posted line's amounts, account, entity, date and entry, and an entry's entity, period, date and kind never change
--   period        an entry's period is its client's period of its own date; a line has its entry's entity and date

-- 0. Existing data must already hold (postJournal enforced the same rules); fail with the offending ids rather than half-apply.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id, ', ') INTO bad FROM (
    SELECT e.id FROM "JournalEntry" e LEFT JOIN "JournalLine" l ON l."entryId" = e.id
    GROUP BY e.id HAVING COUNT(l.id) < 2 OR COALESCE(SUM(l.debit), 0) <> COALESCE(SUM(l.credit), 0) LIMIT 20) x;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'ledger guards: unbalanced or single-line journal entries exist: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (
    SELECT e.id FROM "JournalEntry" e JOIN "Period" p ON p.id = e."periodId" JOIN "Entity" en ON en.id = e."entityId"
    WHERE p."clientId" <> en."clientId" OR p.year <> EXTRACT(YEAR FROM e.date)::int OR p.month <> EXTRACT(MONTH FROM e.date)::int LIMIT 20) x;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'ledger guards: journal entries filed under another period: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (
    SELECT l.id FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE l."entityId" <> e."entityId" OR l.date <> e.date OR l."firmId" <> e."firmId" LIMIT 20) x;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'ledger guards: journal lines whose entity or date differs from their entry: %', bad; END IF;
END $$;

-- Balance checks read an entry's lines by entryId (also speeds up the cascade when an entry is deleted).
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

CREATE FUNCTION "ledger_client_delete"() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('buku.client_delete', true), '') = 'on'
$$;

CREATE FUNCTION "ledger_month_locked"(p_entity text, p_date date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Period" p JOIN "Entity" en ON en."clientId" = p."clientId"
    WHERE en.id = p_entity AND p.year = EXTRACT(YEAR FROM p_date)::int AND p.month = EXTRACT(MONTH FROM p_date)::int AND p.status = 'LOCKED')
$$;

-- 1. Balanced, checked at commit (an entry and its lines are written by several statements in one transaction).
CREATE FUNCTION "ledger_entry_balanced"(p_entry text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint; d numeric; c numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "JournalEntry" WHERE id = p_entry) THEN RETURN; END IF; -- the whole entry went: nothing to balance
  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO n, d, c FROM "JournalLine" WHERE "entryId" = p_entry;
  IF n < 2 THEN RAISE EXCEPTION 'Buku besar: jurnal % harus punya minimal dua baris (aturan 2)', p_entry USING ERRCODE = 'check_violation'; END IF;
  IF d <> c THEN RAISE EXCEPTION 'Buku besar: jurnal % tidak seimbang, debit % ≠ kredit % (aturan 2)', p_entry, d, c USING ERRCODE = 'check_violation'; END IF;
END $$;

CREATE FUNCTION "ledger_line_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "ledger_entry_balanced"(CASE WHEN TG_OP = 'DELETE' THEN OLD."entryId" ELSE NEW."entryId" END);
  IF TG_OP = 'UPDATE' AND NEW."entryId" <> OLD."entryId" THEN PERFORM "ledger_entry_balanced"(OLD."entryId"); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "JournalLine_balanced" AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger_line_balanced"();

CREATE FUNCTION "ledger_entry_has_lines"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "ledger_entry_balanced"(NEW.id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "JournalEntry_balanced" AFTER INSERT ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger_entry_has_lines"();

-- 2. Entries: period of their own date, locked months, immutable core.
CREATE FUNCTION "ledger_entry_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; client text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM "Period" WHERE id = NEW."periodId";
    SELECT "clientId" INTO client FROM "Entity" WHERE id = NEW."entityId";
    IF p.id IS NULL OR p."clientId" <> client OR p.year <> EXTRACT(YEAR FROM NEW.date)::int OR p.month <> EXTRACT(MONTH FROM NEW.date)::int THEN
      RAISE EXCEPTION 'Buku besar: jurnal tanggal % harus masuk periode bulannya sendiri', NEW.date USING ERRCODE = 'check_violation';
    END IF;
    IF p.status = 'LOCKED' THEN
      RAISE EXCEPTION 'Buku besar: periode %-% sudah ditutup (aturan 4)', p.year, lpad(p.month::text, 2, '0') USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."entityId" <> OLD."entityId" OR NEW."periodId" <> OLD."periodId" OR NEW.date <> OLD.date OR NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'Buku besar: jurnal % sudah diposting dan tidak bisa diubah; koreksi dengan jurnal baru (aturan 3)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSE
    IF NOT "ledger_client_delete"() AND EXISTS (SELECT 1 FROM "Period" WHERE id = OLD."periodId" AND status = 'LOCKED') THEN
      RAISE EXCEPTION 'Buku besar: jurnal % ada di periode yang sudah ditutup (aturan 4)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER "JournalEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION "ledger_entry_guard"();

-- 3. Lines: their entry's entity and date, locked months, immutable amounts.
CREATE FUNCTION "ledger_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "entityId", date, "firmId" INTO e FROM "JournalEntry" WHERE id = NEW."entryId";
    IF e."entityId" IS DISTINCT FROM NEW."entityId" OR e.date IS DISTINCT FROM NEW.date OR e."firmId" IS DISTINCT FROM NEW."firmId" THEN
      RAISE EXCEPTION 'Buku besar: baris jurnal harus punya entitas dan tanggal jurnalnya' USING ERRCODE = 'check_violation';
    END IF;
    IF "ledger_month_locked"(NEW."entityId", NEW.date) THEN
      RAISE EXCEPTION 'Buku besar: periode tanggal % sudah ditutup (aturan 4)', NEW.date USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."entryId" <> OLD."entryId" OR NEW."entityId" <> OLD."entityId" OR NEW."accountId" <> OLD."accountId" OR NEW.date <> OLD.date
       OR NEW.debit <> OLD.debit OR NEW.credit <> OLD.credit
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW."fxAmount" IS DISTINCT FROM OLD."fxAmount" OR NEW."fxRate" IS DISTINCT FROM OLD."fxRate" THEN
      RAISE EXCEPTION 'Buku besar: baris jurnal % sudah diposting dan tidak bisa diubah; koreksi dengan jurnal baru (aturan 3)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSE
    IF NOT "ledger_client_delete"() AND "ledger_month_locked"(OLD."entityId", OLD.date) THEN
      RAISE EXCEPTION 'Buku besar: periode tanggal % sudah ditutup (aturan 4)', OLD.date USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END $$;
CREATE TRIGGER "JournalLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION "ledger_line_guard"();

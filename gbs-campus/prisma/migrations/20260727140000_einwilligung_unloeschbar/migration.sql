-- =============================================================================
-- GBS Campus — Einwilligungsnachweis wirklich unveraenderlich machen
--
-- Befund aus dem Code-Review vom 27.07.2026, am laufenden System nachgemessen:
-- Fuer `einwilligungen` gab es nur einen UPDATE-Trigger. `DELETE` lief durch,
-- und ueber `ON DELETE CASCADE` riss das Loeschen EINER Person den kompletten
-- Nachweis mit — von zwei Zeilen auf null. Der Schema-Kommentar behauptete
-- „append-only", der Code hielt es nur zur Haelfte ein. Damit war die
-- Nachweispflicht aus DSGVO Art. 7 Abs. 1 nicht erfuellt.
--
-- Zusaetzlich: Row-Level-Trigger feuern bei TRUNCATE NICHT. Ein einziges
-- `TRUNCATE audit_log` haette bisher das gesamte Protokoll geleert, obwohl
-- UPDATE und DELETE gesperrt waren. Deshalb hier zusaetzlich
-- Statement-Level-Trigger fuer TRUNCATE auf beiden Tabellen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cascade aufloesen: eine geloeschte Person darf ihren Nachweis nicht
--    mitnehmen. Beide Spalten sind bereits optional.
-- -----------------------------------------------------------------------------
ALTER TABLE "einwilligungen" DROP CONSTRAINT IF EXISTS "einwilligungen_personId_fkey";
ALTER TABLE "einwilligungen"
  ADD CONSTRAINT "einwilligungen_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "einwilligungen" DROP CONSTRAINT IF EXISTS "einwilligungen_anmeldungId_fkey";
ALTER TABLE "einwilligungen"
  ADD CONSTRAINT "einwilligungen_anmeldungId_fkey"
  FOREIGN KEY ("anmeldungId") REFERENCES "anmeldungen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 2. DELETE sperren — bisher fehlte dieser Trigger als einziger.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS einwilligung_kein_delete ON einwilligungen;
CREATE TRIGGER einwilligung_kein_delete
  BEFORE DELETE ON einwilligungen
  FOR EACH ROW EXECUTE FUNCTION audit_log_ist_unveraenderlich();

REVOKE UPDATE, DELETE, TRUNCATE ON einwilligungen FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. TRUNCATE sperren — auf beiden Tabellen.
--
--    Zeilen-Trigger greifen bei TRUNCATE nicht. Ohne diese beiden Trigger
--    genuegte ein einziges Statement, um Audit-Log oder Einwilligungen
--    vollstaendig zu leeren, obwohl UPDATE und DELETE gesperrt sind.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_log_kein_truncate ON audit_log;
CREATE TRIGGER audit_log_kein_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_ist_unveraenderlich();

DROP TRIGGER IF EXISTS einwilligung_kein_truncate ON einwilligungen;
CREATE TRIGGER einwilligung_kein_truncate
  BEFORE TRUNCATE ON einwilligungen
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_ist_unveraenderlich();

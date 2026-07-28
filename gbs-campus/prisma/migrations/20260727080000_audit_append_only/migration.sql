-- =============================================================================
-- GBS Campus — Unveraenderbarkeit und Eindeutigkeit auf Datenbankebene
--
-- Prisma kann beides im Schema nicht ausdruecken, deshalb diese Handmigration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Audit-Log: append-only
--
-- Der Trigger blockiert UPDATE und DELETE fuer jeden Verbindungsweg — auch fuer
-- die Anwendung selbst und auch fuer den Administrator ueber die Oberflaeche.
-- Ein Programmierfehler, der Audit-Zeilen aendern oder loeschen wuerde, scheitert
-- damit laut statt still.
--
-- Ehrliche Grenze: Wer direkten psql-Zugang mit Eigentuemerrechten auf die
-- Datenbank hat, kann den Trigger entfernen. Vollstaendig absichern liesse sich
-- das nur mit einem getrennten, rechtebeschraenkten Anwendungs-Datenbanknutzer.
-- Das ist der naechste Haertungsschritt, nicht Teil von Release 0.1.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_ist_unveraenderlich()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Das Audit-Log ist append-only: % auf audit_log ist nicht zulaessig.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_kein_update ON audit_log;
CREATE TRIGGER audit_log_kein_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_ist_unveraenderlich();

DROP TRIGGER IF EXISTS audit_log_kein_delete ON audit_log;
CREATE TRIGGER audit_log_kein_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_ist_unveraenderlich();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. Einwilligungen: ebenfalls unveraenderlich
--
-- Ein Consent-Protokoll, das sich nachtraeglich aendern laesst, ist als Nachweis
-- nach DSGVO Art. 7 Abs. 1 nichts wert. Ein Widerruf ist deshalb eine neue Zeile
-- mit erteilt = false, kein UPDATE der alten.
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS einwilligung_kein_update ON einwilligungen;
CREATE TRIGGER einwilligung_kein_update
  BEFORE UPDATE ON einwilligungen
  FOR EACH ROW EXECUTE FUNCTION audit_log_ist_unveraenderlich();

-- -----------------------------------------------------------------------------
-- 3. Genau ein laufendes Semester
--
-- Ein partieller Unique-Index laesst beliebig viele Zeilen mit istAktuell = false
-- zu, aber nur eine einzige mit true. Ohne das koennten sich zwei „aktuelle"
-- Semester ueberlagern und Listen, Export und Verteiler waeren zweideutig.
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS semester_genau_ein_aktuelles
  ON semester ("istAktuell")
  WHERE "istAktuell" = true;

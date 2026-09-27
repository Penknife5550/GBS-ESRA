-- =============================================================================
-- GBS Campus — Eingefrorene Belege auf DB-Ebene unveraenderlich machen
--
-- Befund aus dem Code-Review vom 26.09.2026 (Architektur): Honorarsatz-Historie
-- („Korrekturen sind neue Zeilen, kein Update"), Abrechnungsposten und -summe
-- („eingefroren") und Zeugnis-Snapshots („eingefrorenes Dokument") waren nur
-- per Konvention unveraenderlich. Der Anwendungsnutzer gbs_app hatte UPDATE und
-- DELETE auf alle vier Tabellen; ein Programmierfehler oder ein SQL-Eingriff
-- konnte eingefrorene Betraege oder Zeugnisinhalte still veraendern. Fuer
-- Nachweisdaten gilt im Projekt: Durchsetzung auf DB-Ebene statt Konvention
-- (wie audit_log, einwilligungen, einwilligungs_texte).
--
-- Erlaubt bleibt genau das, was die Anwendung tut:
--   honorar_saetze            Beleg-Nr und DMS-Versand nachtragen (leer -> Wert,
--                             danach fest). Kein DELETE — eine Korrektur ist
--                             eine neue Zeile.
--   honorar_abrechnungen      Statuskette OFFEN -> FREIGEGEBEN -> AUSGEZAHLT;
--                             Beleg-, Freigabe-, Auszahlungs- und DMS-Felder nur
--                             leer -> Wert. Summe, Dozent, Semester, Notiz usw.
--                             fest. DELETE nur OFFEN (Storno,
--                             storniereAbrechnung in honorar-abrechnung-io.ts).
--   honorar_abrechnung_posten INSERT nur zu einer OFFENEN Abrechnung (erstelle-
--                             Abrechnung legt Kopf und Posten in einer
--                             Transaktion an); kein UPDATE; DELETE nur als Folge
--                             des Stornos (Cascade von der Abrechnung), nie
--                             einzeln. Beim Commit muss die Summe der Abrechnung
--                             der Summe ihrer Posten entsprechen (verzoegerter
--                             Constraint-Trigger, Abschnitt 3a).
--   zeugnisse                 status nur GUELTIG -> ERSETZT (Neuausstellung),
--                             dmsGesendetAm nur leer -> Wert, snapshot nur der
--                             Anonymisierungs-Scrub (scrubbeZeugnisSnapshot in
--                             src/lib/anonymisierung.ts). Alles andere fest.
--
-- TRUNCATE ist auf allen vier Tabellen gesperrt (Zeilen-Trigger greifen dabei
-- nicht, siehe 20260727140000_einwilligung_unloeschbar). Das DELETE auf
-- zeugnisse sperrt kein Trigger, sondern das entzogene Recht fuer gbs_app
-- (prisma/setup-app-nutzer.ts): Der Fremdschluessel zur Person ist ON DELETE
-- CASCADE, ein Trigger machte daraus ein stilles Restrict. ACHTUNG: Das REVOKE
-- sperrt nur das DIREKTE DELETE. Fremdschluessel-Aktionen fuehrt Postgres als
-- Eigentuemer der Tabelle aus — loescht jemand (auch gbs_app, das DELETE auf
-- personen hat) eine Person, verschwinden ihre Zeugnisse per Cascade mit. Heute
-- gibt es keinen Loeschpfad fuer Personen im Code; der Betrieb loescht Personen
-- nicht, er anonymisiert (Art. 17). Den Cascade-Weg schliessen wuerde erst ein
-- RESTRICT auf zeugnisse_personId_fkey oder ein REVOKE DELETE ON personen
-- (offene Entscheidung, siehe UEBERGABE.md).
--
-- Verglichen wird wie in 20260927100000_einwilligungstexte_unveraenderlich die
-- Zeile als jsonb OHNE die aenderbaren Spalten: Eine spaeter ergaenzte Spalte
-- ist damit automatisch gesperrt, statt still offen zu bleiben. Ein UPDATE, das
-- nichts aendert (No-op), geht durch. Muss eine spaetere Migration eine neue
-- Spalte nachfuellen, schaltet sie den betroffenen Trigger dafuer ausdruecklich
-- ab und direkt wieder an (ALTER TABLE … DISABLE/ENABLE TRIGGER …).
--
-- Handmigration, nur additive Anweisungen (DROP nur fuer die eigenen, hier neu
-- angelegten Trigger-Namen). `prisma migrate dev` kennt Trigger nicht —
-- erzeugte Migrationen vor dem Committen ansehen, diese Trigger nie droppen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. honorar_saetze: nur Beleg-Nr und DMS-Versand nachtragen
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION honorar_satz_ist_eingefroren()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['dmsBelegNr', 'dmsGesendetAm'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['dmsBelegNr', 'dmsGesendetAm'])
       AND (OLD."dmsBelegNr" IS NULL OR NEW."dmsBelegNr" IS NOT DISTINCT FROM OLD."dmsBelegNr")
       AND (OLD."dmsGesendetAm" IS NULL OR NEW."dmsGesendetAm" IS NOT DISTINCT FROM OLD."dmsGesendetAm") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Ein genehmigter Honorarsatz ist eingefroren. Nachtragen lassen sich nur Beleg-Nr und DMS-Versand (einmalig); eine Korrektur ist ein neuer Satz.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS honorar_satz_nur_dms_nachtrag ON honorar_saetze;
CREATE TRIGGER honorar_satz_nur_dms_nachtrag
  BEFORE UPDATE ON honorar_saetze
  FOR EACH ROW EXECUTE FUNCTION honorar_satz_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_satz_kein_delete ON honorar_saetze;
CREATE TRIGGER honorar_satz_kein_delete
  BEFORE DELETE ON honorar_saetze
  FOR EACH ROW EXECUTE FUNCTION honorar_satz_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_satz_kein_truncate ON honorar_saetze;
CREATE TRIGGER honorar_satz_kein_truncate
  BEFORE TRUNCATE ON honorar_saetze
  FOR EACH STATEMENT EXECUTE FUNCTION honorar_satz_ist_eingefroren();

REVOKE DELETE, TRUNCATE ON honorar_saetze FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. honorar_abrechnungen: Statuskette, Nachtraege einmalig, DELETE nur OFFEN
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION honorar_abrechnung_ist_eingefroren()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Storno: Eine OFFENE Abrechnung hat noch keinen Beleg herausgegeben. Eine
    -- freigegebene (Zahlungsbeleg mit IBAN beim DMS) oder ausgezahlte bleibt.
    IF OLD.status = 'OFFEN' THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'belegNr', 'dmsGesendetAm', 'freigegebenVonId', 'freigegebenAm', 'ausgezahltVonId', 'ausgezahltAm'])
         IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'belegNr', 'dmsGesendetAm', 'freigegebenVonId', 'freigegebenAm', 'ausgezahltVonId', 'ausgezahltAm'])
       AND (NEW.status = OLD.status
            OR (OLD.status = 'OFFEN' AND NEW.status = 'FREIGEGEBEN')
            OR (OLD.status = 'FREIGEGEBEN' AND NEW.status = 'AUSGEZAHLT'))
       AND (OLD."belegNr" IS NULL OR NEW."belegNr" IS NOT DISTINCT FROM OLD."belegNr")
       AND (OLD."dmsGesendetAm" IS NULL OR NEW."dmsGesendetAm" IS NOT DISTINCT FROM OLD."dmsGesendetAm")
       AND (OLD."freigegebenVonId" IS NULL OR NEW."freigegebenVonId" IS NOT DISTINCT FROM OLD."freigegebenVonId")
       AND (OLD."freigegebenAm" IS NULL OR NEW."freigegebenAm" IS NOT DISTINCT FROM OLD."freigegebenAm")
       AND (OLD."ausgezahltVonId" IS NULL OR NEW."ausgezahltVonId" IS NOT DISTINCT FROM OLD."ausgezahltVonId")
       AND (OLD."ausgezahltAm" IS NULL OR NEW."ausgezahltAm" IS NOT DISTINCT FROM OLD."ausgezahltAm") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Eine Honorar-Abrechnung ist eingefroren. Erlaubt sind nur die Schritte OFFEN -> FREIGEGEBEN -> AUSGEZAHLT (Beleg-, Freigabe-, Auszahlungs- und DMS-Angaben einmalig nachtragen) und der Storno einer OFFENEN Abrechnung.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS honorar_abrechnung_nur_statuskette ON honorar_abrechnungen;
CREATE TRIGGER honorar_abrechnung_nur_statuskette
  BEFORE UPDATE ON honorar_abrechnungen
  FOR EACH ROW EXECUTE FUNCTION honorar_abrechnung_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_abrechnung_delete_nur_offen ON honorar_abrechnungen;
CREATE TRIGGER honorar_abrechnung_delete_nur_offen
  BEFORE DELETE ON honorar_abrechnungen
  FOR EACH ROW EXECUTE FUNCTION honorar_abrechnung_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_abrechnung_kein_truncate ON honorar_abrechnungen;
CREATE TRIGGER honorar_abrechnung_kein_truncate
  BEFORE TRUNCATE ON honorar_abrechnungen
  FOR EACH STATEMENT EXECUTE FUNCTION honorar_abrechnung_ist_eingefroren();

REVOKE TRUNCATE ON honorar_abrechnungen FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. honorar_abrechnung_posten: INSERT nur zu OFFEN, kein UPDATE, DELETE nur per
--    Storno-Cascade
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION honorar_posten_ist_eingefroren()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Neue Posten nur zu einer OFFENEN Abrechnung. erstelleAbrechnung legt Kopf
    -- und Posten in EINER Transaktion an (verschachteltes create) — der Kopf ist
    -- dann schon da und OFFEN. Einer freigegebenen oder ausgezahlten Abrechnung
    -- laesst sich nichts anhaengen: Der Zahlungsbeleg passte sonst nicht mehr zur
    -- Summe, und der angehaengte Abend gaelte (Unique auf terminId) dauerhaft als
    -- abgerechnet, ohne je bezahlt zu werden.
    IF EXISTS (SELECT 1 FROM honorar_abrechnungen WHERE id = NEW."abrechnungId" AND status = 'OFFEN') THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- Der Fremdschluessel (ON DELETE CASCADE) loescht die Posten erst, NACHDEM
    -- die Abrechnung geloescht ist — sie ist dann nicht mehr sichtbar, und ihr
    -- DELETE-Trigger laesst nur OFFENE zu. Ein einzelner Posten einer noch
    -- bestehenden Abrechnung bleibt dagegen stehen: Sonst passte die
    -- eingefrorene Summe nicht mehr, und der Abend waere wieder abrechenbar.
    IF NOT EXISTS (SELECT 1 FROM honorar_abrechnungen WHERE id = OLD."abrechnungId") THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Ein Abrechnungsposten ist eingefroren. Neue Posten gibt es nur beim Anlegen einer (OFFENEN) Abrechnung; ein Posten verschwindet nur mit dem Storno seiner OFFENEN Abrechnung.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS honorar_posten_insert_nur_offen ON honorar_abrechnung_posten;
CREATE TRIGGER honorar_posten_insert_nur_offen
  BEFORE INSERT ON honorar_abrechnung_posten
  FOR EACH ROW EXECUTE FUNCTION honorar_posten_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_posten_kein_update ON honorar_abrechnung_posten;
CREATE TRIGGER honorar_posten_kein_update
  BEFORE UPDATE ON honorar_abrechnung_posten
  FOR EACH ROW EXECUTE FUNCTION honorar_posten_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_posten_delete_nur_storno ON honorar_abrechnung_posten;
CREATE TRIGGER honorar_posten_delete_nur_storno
  BEFORE DELETE ON honorar_abrechnung_posten
  FOR EACH ROW EXECUTE FUNCTION honorar_posten_ist_eingefroren();

DROP TRIGGER IF EXISTS honorar_posten_kein_truncate ON honorar_abrechnung_posten;
CREATE TRIGGER honorar_posten_kein_truncate
  BEFORE TRUNCATE ON honorar_abrechnung_posten
  FOR EACH STATEMENT EXECUTE FUNCTION honorar_posten_ist_eingefroren();

REVOKE UPDATE, DELETE, TRUNCATE ON honorar_abrechnung_posten FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3a. Summe = Summe der Posten (beim Commit)
--
--    `summe` ist eine redundante Kopie der Posten-Summe. Geprueft wird erst
--    beim Commit (DEFERRABLE INITIALLY DEFERRED): Prisma legt beim
--    verschachtelten create zuerst den Kopf an, danach die Posten — dazwischen
--    stimmt die Summe noch nicht. Ist die Abrechnung beim Commit nicht mehr da
--    (Storno in derselben Transaktion), gibt es nichts zu pruefen. Ein UPDATE der
--    Summe verhindert schon Abschnitt 2, ein einzelnes DELETE von Posten
--    Abschnitt 3.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION honorar_abrechnung_summe_pruefen()
RETURNS TRIGGER AS $$
DECLARE
  kopf_id text;
  kopf_summe integer;
  posten_summe bigint;
BEGIN
  IF TG_TABLE_NAME = 'honorar_abrechnungen' THEN
    kopf_id := NEW.id;
  ELSE
    kopf_id := NEW."abrechnungId";
  END IF;
  SELECT summe INTO kopf_summe FROM honorar_abrechnungen WHERE id = kopf_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM(betrag), 0) INTO posten_summe FROM honorar_abrechnung_posten WHERE "abrechnungId" = kopf_id;
  IF posten_summe <> kopf_summe THEN
    RAISE EXCEPTION
      'Die Summe der Honorar-Abrechnung % (%) passt nicht zur Summe ihrer Posten (%).',
      kopf_id, kopf_summe, posten_summe
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS honorar_abrechnung_summe_passt ON honorar_abrechnungen;
CREATE CONSTRAINT TRIGGER honorar_abrechnung_summe_passt
  AFTER INSERT ON honorar_abrechnungen
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION honorar_abrechnung_summe_pruefen();

DROP TRIGGER IF EXISTS honorar_posten_summe_passt ON honorar_abrechnung_posten;
CREATE CONSTRAINT TRIGGER honorar_posten_summe_passt
  AFTER INSERT ON honorar_abrechnung_posten
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION honorar_abrechnung_summe_pruefen();

-- -----------------------------------------------------------------------------
-- 4. zeugnisse: Status GUELTIG -> ERSETZT, DMS-Versand, Anonymisierungs-Scrub
--
--    Der Scrub ersetzt im Snapshot genau den Schluessel `person` durch
--    {"name": "[anonymisiert]", "geburtsdatum": null} und laesst alles andere
--    (Faecher, Ergebnisse, Beleg-Vermerke) stehen. Aendert sich
--    scrubbeZeugnisSnapshot, muss dieser Vergleich mitgehen — sonst scheitert
--    die Anonymisierung laut (scripts/pruefe-betrieb.ts prueft beides gegeneinander).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zeugnis_ist_eingefroren()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'dmsGesendetAm', 'snapshot'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'dmsGesendetAm', 'snapshot'])
       AND (NEW.status = OLD.status OR (OLD.status = 'GUELTIG' AND NEW.status = 'ERSETZT'))
       AND (OLD."dmsGesendetAm" IS NULL OR NEW."dmsGesendetAm" IS NOT DISTINCT FROM OLD."dmsGesendetAm") THEN
      IF NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot THEN
        RETURN NEW;
      END IF;
      IF jsonb_typeof(OLD.snapshot) = 'object' AND jsonb_typeof(NEW.snapshot) = 'object' THEN
        IF (NEW.snapshot - 'person') = (OLD.snapshot - 'person')
           AND NEW.snapshot -> 'person' = '{"name": "[anonymisiert]", "geburtsdatum": null}'::jsonb THEN
          RETURN NEW;
        END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Ein ausgestelltes Zeugnis ist eingefroren. Erlaubt sind nur GUELTIG -> ERSETZT (Neuausstellung), der DMS-Versand (einmalig) und die Anonymisierung des Namens; eine Korrektur ist eine Neuausstellung.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zeugnis_nur_status_dms_scrub ON zeugnisse;
CREATE TRIGGER zeugnis_nur_status_dms_scrub
  BEFORE UPDATE ON zeugnisse
  FOR EACH ROW EXECUTE FUNCTION zeugnis_ist_eingefroren();

DROP TRIGGER IF EXISTS zeugnis_kein_truncate ON zeugnisse;
CREATE TRIGGER zeugnis_kein_truncate
  BEFORE TRUNCATE ON zeugnisse
  FOR EACH STATEMENT EXECUTE FUNCTION zeugnis_ist_eingefroren();

REVOKE DELETE, TRUNCATE ON zeugnisse FROM PUBLIC;

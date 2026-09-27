-- =============================================================================
-- GBS Campus — Einwilligungstexte unveraenderlich machen
--
-- Befund M8 aus dem Code-Review vom 26.09.2026: Die Einwilligungen selbst sind
-- append-only (20260727080000, 20260727140000), der Text, auf den sie ueber
-- `textId` zeigen, war es nicht. Es gab keinen Trigger auf
-- `einwilligungs_texte`, und der Seed setzte bei jedem Containerstart Titel und
-- Text per upsert neu. Wer einen Tippfehler im Text korrigierte, ohne `version`
-- zu erhoehen, aenderte damit rueckwirkend den Text aller bereits erteilten
-- Einwilligungen. Der Nachweis nach DSGVO Art. 7 Abs. 1 (welchem Text wurde
-- zugestimmt?) lief damit ins Leere — ausgerechnet bei der Art.-9-Einwilligung.
--
-- Regel ab hier: Eine Fassung ist nach dem Anlegen eingefroren. Aenderbar ist
-- nur `aktivBis` (eine Fassung ausser Kraft setzen). Jede inhaltliche Aenderung
-- — Titel, Text, Art.-9-Kennzeichen, Pflicht, Gueltigkeitsbeginn — ist eine
-- neue Fassung (version + 1); die alte bleibt fuer ihre Einwilligungen stehen.
-- Der Seed legt Fassungen seitdem nur noch an und ueberschreibt nie.
--
-- Handmigration, nur additive Anweisungen. Wie bei den Append-only-Triggern:
-- `prisma migrate dev` kennt Trigger nicht — erzeugte Migrationen vor dem
-- Committen ansehen, diese Trigger nie droppen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger-Funktion
--
--    Verglichen wird die ganze Zeile ohne `aktivBis` (als jsonb). So ist auch
--    eine spaeter ergaenzte Spalte automatisch gesperrt, statt still offen zu
--    bleiben. IS DISTINCT FROM statt <>: Ein UPDATE, das nichts aendert (No-op),
--    geht durch und scheitert nicht — nur eine echte Aenderung scheitert.
--
--    Muss eine spaetere Migration eine neue Spalte nachfuellen, schaltet sie den
--    Trigger dafuer ausdruecklich ab und direkt wieder an
--    (ALTER TABLE … DISABLE/ENABLE TRIGGER einwilligungs_text_nur_aktiv_bis).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION einwilligungs_text_ist_unveraenderlich()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'aktivBis') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'aktivBis') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION
    '% auf % ist nicht zulaessig: Eine Fassung ist nach dem Anlegen eingefroren, erteilte Einwilligungen verweisen auf sie. Aenderbar ist nur aktivBis (ausser Kraft setzen); ein geaenderter Text ist eine neue Fassung (version + 1).',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 2. UPDATE: nur aktivBis
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS einwilligungs_text_nur_aktiv_bis ON einwilligungs_texte;
CREATE TRIGGER einwilligungs_text_nur_aktiv_bis
  BEFORE UPDATE ON einwilligungs_texte
  FOR EACH ROW EXECUTE FUNCTION einwilligungs_text_ist_unveraenderlich();

-- -----------------------------------------------------------------------------
-- 3. DELETE sperren
--
--    Der Fremdschluessel aus `einwilligungen` (ON DELETE RESTRICT) schuetzt nur
--    Fassungen, auf die schon eine Einwilligung zeigt. Eine Fassung wird nie
--    geloescht, sondern ueber aktivBis ausser Kraft gesetzt.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS einwilligungs_text_kein_delete ON einwilligungs_texte;
CREATE TRIGGER einwilligungs_text_kein_delete
  BEFORE DELETE ON einwilligungs_texte
  FOR EACH ROW EXECUTE FUNCTION einwilligungs_text_ist_unveraenderlich();

-- -----------------------------------------------------------------------------
-- 4. TRUNCATE sperren — Zeilen-Trigger greifen bei TRUNCATE nicht
--    (siehe 20260727140000_einwilligung_unloeschbar).
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS einwilligungs_text_kein_truncate ON einwilligungs_texte;
CREATE TRIGGER einwilligungs_text_kein_truncate
  BEFORE TRUNCATE ON einwilligungs_texte
  FOR EACH STATEMENT EXECUTE FUNCTION einwilligungs_text_ist_unveraenderlich();

REVOKE UPDATE, DELETE, TRUNCATE ON einwilligungs_texte FROM PUBLIC;

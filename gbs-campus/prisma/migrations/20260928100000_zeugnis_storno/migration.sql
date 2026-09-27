-- =============================================================================
-- GBS Campus — Zeugnis-Storno ohne Ersatz
--
-- Eine Fehlausstellung (falsches Semester, falscher Typ, Person gar nicht
-- teilnahmeberechtigt) liess sich bisher nur durch „Neu ausstellen" ersetzen,
-- nicht zurueckziehen. Neu ist der Status STORNIERT: Das Zeugnis wird ungueltig
-- und fuer die Person nicht mehr abrufbar, bleibt aber als Nachweis stehen —
-- mit Zeitpunkt, Akteur und Pflicht-Grund (Freitext der Schulleitung).
--
-- Die Trigger-Funktion zeugnis_ist_eingefroren (Migration
-- 20260927160000_belege_unveraenderlich) wird erweitert; alle bisherigen
-- Garantien bleiben:
--   - status nur GUELTIG -> ERSETZT (Neuausstellung) und neu GUELTIG ->
--     STORNIERT, Letzteres nur zusammen mit gesetztem storniertAm und
--     nicht-leerem stornoGrund. STORNIERT und ERSETZT sind endgueltig.
--   - storniertAm, storniertVonId und stornoGrund entstehen nur mit dem Storno
--     und bleiben danach fest — bis auf den Anonymisierungs-Scrub, der den
--     Grund durch den Platzhalter '[anonymisiert]' ersetzt (ANONYM_PLATZHALTER
--     in src/lib/anonymisierung.ts; scripts/pruefe-betrieb.ts prueft beide
--     Literale gegeneinander).
--   - Snapshot eingefroren bis auf den Scrub von `person`, dmsGesendetAm nur
--     leer -> Wert, TRUNCATE gesperrt (Trigger), DELETE fuer gbs_app entzogen
--     (prisma/setup-app-nutzer.ts). Die Trigger selbst bleiben unveraendert —
--     CREATE OR REPLACE tauscht nur den Rumpf der Funktion.
--
-- Handmigration im Prisma-Stil, nur additive Anweisungen (keine DROPs).
-- `prisma migrate dev` kennt weder Trigger noch CHECK-Constraints — erzeugte
-- Migrationen vor dem Committen ansehen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum-Wert. ADD VALUE laeuft in der Transaktion der Migration; benutzen
--    laesst sich der neue Wert erst nach deren Commit (Postgres bricht sonst
--    mit „unsafe use of new value" ab). Deshalb vergleicht der CHECK unten ueber
--    ::text, und die Trigger-Funktion wertet 'STORNIERT' erst zur Laufzeit aus.
-- -----------------------------------------------------------------------------
ALTER TYPE "Zeugnisstatus" ADD VALUE 'STORNIERT';

-- -----------------------------------------------------------------------------
-- 2. Storno-Felder. storniertVonId ist die Akteur-Id (keine Relation, wie
--    ausgestelltVonId).
-- -----------------------------------------------------------------------------
ALTER TABLE "zeugnisse" ADD COLUMN "storniertAm" TIMESTAMP(3),
ADD COLUMN "storniertVonId" TEXT,
ADD COLUMN "stornoGrund" TEXT;

-- -----------------------------------------------------------------------------
-- 3. Konsistenz auch beim INSERT (der Trigger unten wacht nur ueber UPDATEs):
--    Zeitpunkt und Grund genau dann, wenn STORNIERT; ein Grund ist nie leer.
--    Prisma kennt CHECK-Constraints nicht, laesst sie aber stehen (sie tauchen
--    im Diff nicht auf). Die Ausdruecke ergeben nie NULL (IS [NOT] NULL, und
--    btrim nur hinter „IS NULL OR"), ein NULL-Ergebnis gaelte als erfuellt.
-- -----------------------------------------------------------------------------
ALTER TABLE "zeugnisse" ADD CONSTRAINT "zeugnisse_storno_konsistent" CHECK (
    ("status"::text = 'STORNIERT') = ("storniertAm" IS NOT NULL)
    AND ("storniertAm" IS NULL) = ("stornoGrund" IS NULL)
    AND ("stornoGrund" IS NULL OR btrim("stornoGrund") <> '')
);

-- -----------------------------------------------------------------------------
-- 4. zeugnis_ist_eingefroren: zusaetzlich GUELTIG -> STORNIERT und der Scrub
--    des Storno-Grundes. Die Storno-Spalten sind vom Zeilenvergleich
--    ausgenommen und werden einzeln geregelt; jede spaeter ergaenzte Spalte
--    bleibt wie bisher automatisch gesperrt.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zeugnis_ist_eingefroren()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'dmsGesendetAm', 'snapshot', 'storniertAm', 'storniertVonId', 'stornoGrund'])
         IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'dmsGesendetAm', 'snapshot', 'storniertAm', 'storniertVonId', 'stornoGrund'])
       AND (OLD."dmsGesendetAm" IS NULL OR NEW."dmsGesendetAm" IS NOT DISTINCT FROM OLD."dmsGesendetAm")
       AND (
         -- Status bleibt: die Storno-Felder auch — bis auf den Scrub des Grundes.
         (NEW.status = OLD.status
          AND NEW."storniertAm" IS NOT DISTINCT FROM OLD."storniertAm"
          AND NEW."storniertVonId" IS NOT DISTINCT FROM OLD."storniertVonId"
          AND (NEW."stornoGrund" IS NOT DISTINCT FROM OLD."stornoGrund"
               OR (OLD."stornoGrund" IS NOT NULL AND NEW."stornoGrund" IS NOT DISTINCT FROM '[anonymisiert]')))
         -- Neuausstellung: das alte Zeugnis wird ERSETZT, ohne Storno-Felder.
         OR (OLD.status = 'GUELTIG' AND NEW.status = 'ERSETZT'
             AND NEW."storniertAm" IS NULL AND NEW."storniertVonId" IS NULL AND NEW."stornoGrund" IS NULL)
         -- Storno ohne Ersatz: nur mit Zeitpunkt und nicht-leerem Grund.
         OR (OLD.status = 'GUELTIG' AND NEW.status = 'STORNIERT'
             AND OLD."storniertAm" IS NULL AND OLD."storniertVonId" IS NULL AND OLD."stornoGrund" IS NULL
             AND NEW."storniertAm" IS NOT NULL
             AND NEW."stornoGrund" IS NOT NULL AND btrim(NEW."stornoGrund") <> '')
       ) THEN
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
    '% auf % ist nicht zulaessig: Ein ausgestelltes Zeugnis ist eingefroren. Erlaubt sind nur GUELTIG -> ERSETZT (Neuausstellung), GUELTIG -> STORNIERT (mit Zeitpunkt und Grund), der DMS-Versand (einmalig) und die Anonymisierung von Name und Storno-Grund; eine Korrektur ist eine Neuausstellung.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

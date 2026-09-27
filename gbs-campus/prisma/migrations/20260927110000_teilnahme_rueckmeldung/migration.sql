-- Semesterueberleitung: „bin dabei" / „bin raus" und Herausfallen ohne Rueckmeldung (M10).
--
-- Fachentscheidung: Wer „bin raus" klickt ODER bis Semesterstart nicht antwortet,
-- dessen Teilnahme im neuen Semester wird als abgemeldet markiert und faellt aus
-- allen Listen dieses Semesters. Der Personenstatus bleibt unveraendert; die
-- Schulleitung kann einzeln wieder aufnehmen.
--
-- Handmigration im Prisma-Stil (der Diff laeuft auf diesem Rechner nicht durch;
-- ausserdem nimmt `prisma migrate dev` DROPs fuer den partiellen Index
-- `semester_genau_ein_aktuelles` und die Append-only-Trigger auf). Nur additive
-- Anweisungen, keine DROPs. Namen wie von Prisma vergeben.

-- -----------------------------------------------------------------------------
-- 1. Teilnahme: Einladung und Abmeldung.
--    eingeladenAm  — die Ueberleitung hat zu dieser Teilnahme eingeladen. Anders
--                    als der Token (den der Aufraeumlauf nach Semesterstart
--                    loescht) bleibt die Markierung stehen.
--    abgemeldetAm  — gesetzt = die Teilnahme zaehlt nicht.
--    abmeldeGrund  — 'BIN_RAUS' | 'KEINE_RUECKMELDUNG'.
-- -----------------------------------------------------------------------------
ALTER TABLE "teilnahmen" ADD COLUMN "eingeladenAm" TIMESTAMP(3);
ALTER TABLE "teilnahmen" ADD COLUMN "abgemeldetAm" TIMESTAMP(3);
ALTER TABLE "teilnahmen" ADD COLUMN "abmeldeGrund" TEXT;

-- Kein zusaetzlicher Index: Jede Abfrage auf „zaehlende Teilnahmen" filtert
-- zuerst ueber den vorhandenen Index auf "semesterId" (ein Semester hat rund
-- 60-150 Teilnahmen); ein Index auf die fast immer leere Spalte "abgemeldetAm"
-- braechte bei dieser Groesse nichts.

-- -----------------------------------------------------------------------------
-- 2. Konsistenz auf DB-Ebene: Grund genau dann, wenn abgemeldet — und nur einer
--    der beiden bekannten Gruende. Prisma kennt CHECK-Constraints nicht, laesst
--    sie aber auch bei `migrate dev` stehen (sie tauchen im Diff nicht auf).
--    Das explizite `"abmeldeGrund" IS NOT NULL` ist noetig: `NULL IN (...)`
--    ergibt NULL, und ein CHECK, der NULL ergibt, gilt als erfuellt — ohne den
--    Zusatz ginge abgemeldetAm gesetzt mit Grund NULL durch.
-- -----------------------------------------------------------------------------
ALTER TABLE "teilnahmen" ADD CONSTRAINT "teilnahmen_abmeldung_konsistent" CHECK (
    ("abgemeldetAm" IS NULL AND "abmeldeGrund" IS NULL)
    OR ("abgemeldetAm" IS NOT NULL AND "abmeldeGrund" IS NOT NULL
        AND "abmeldeGrund" IN ('BIN_RAUS', 'KEINE_RUECKMELDUNG'))
);

-- -----------------------------------------------------------------------------
-- 3. Bestand: Offene Einladungen in Semestern, die noch NICHT begonnen haben,
--    als eingeladen markieren — sonst bekaemen sie keine Erinnerung mehr und
--    fielen zum Semesterstart nicht heraus. Erkennbar sind sie am Token bzw. an
--    einer schon verschickten Erinnerungsstufe (beides setzt nur die Ueberleitung).
--    Bewusst NICHT fuer laufende oder vergangene Semester: Dort wuerde der
--    naechste Worker-Lauf sonst Teilnehmer ohne Bestaetigung rueckwirkend aus
--    allen Listen nehmen.
-- -----------------------------------------------------------------------------
UPDATE "teilnahmen" AS t
SET "eingeladenAm" = t."erstelltAm"
FROM "semester" AS s
WHERE t."semesterId" = s."id"
  AND s."start" > CURRENT_DATE
  AND t."eingeladenAm" IS NULL
  AND (
    t."bestaetigungTokenHash" IS NOT NULL
    OR t."erinnertStufe1Am" IS NOT NULL
    OR t."erinnertStufe2Am" IS NOT NULL
    OR t."erinnertStufe3Am" IS NOT NULL
  );

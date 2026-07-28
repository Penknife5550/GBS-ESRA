-- =============================================================================
-- Anmeldung bekommt einen Semesterbezug
--
-- Bis hierher liess sich nur ueber `eingereichtAm` erraten, fuer welches
-- Semester sich jemand angemeldet hat. Das Feld beendet das Raten, solange die
-- Tabelle noch klein ist.
--
-- SET NULL statt CASCADE ist Absicht: Das Loeschen eines Semesters darf keine
-- Anmeldung samt Einwilligungsnachweis mitreissen.
-- =============================================================================

ALTER TABLE "anmeldungen" ADD COLUMN "semesterId" TEXT;

CREATE INDEX "anmeldungen_semesterId_idx" ON "anmeldungen"("semesterId");

ALTER TABLE "anmeldungen"
  ADD CONSTRAINT "anmeldungen_semesterId_fkey"
  FOREIGN KEY ("semesterId") REFERENCES "semester"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Eine Anmeldung je Person UND Semester statt einer je Person
--
-- Bisher galt `anmeldungen.personId` als eindeutig — eine Person konnte sich
-- also fuer immer genau einmal anmelden. Das vertraegt sich nicht mit dem
-- Semesterbezug, den dieselbe Tabelle seit dem 27.07. traegt: Wer nach einer
-- Pause wiederkommt oder ab Release 0.2 ueber die Semesterueberleitung erneut
-- zusagt, braucht eine zweite Anmeldung.
--
-- Eindeutig ist ab jetzt das PAAR aus Person und Semester. Zweimal dasselbe
-- Semester ist ein Doppelklick und wird weiterhin abgewiesen; zweimal
-- verschiedene Semester ist ein Lebenslauf.
--
-- NULL-Werte sind davon nicht betroffen: Postgres behandelt sie in
-- Unique-Indexen als verschieden. Anmeldungen ohne Person (geloescht) oder ohne
-- Semester (angelegt, bevor eines existierte) bleiben also moeglich.
--
-- Jetzt gemacht, solange die Tabelle leer ist — spaeter waere es eine
-- Datenmigration.
-- =============================================================================

DROP INDEX "anmeldungen_personId_key";

CREATE UNIQUE INDEX "anmeldungen_personId_semesterId_key" ON "anmeldungen"("personId", "semesterId");

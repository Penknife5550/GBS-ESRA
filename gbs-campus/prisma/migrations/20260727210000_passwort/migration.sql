-- =============================================================================
-- Passwort als zweiter Anmeldeweg
--
-- Der Magic-Link haengt am Postfach: Wer den Zugriff darauf verliert, kaeme
-- ohne Passwort nicht mehr hinein. Umgekehrt ersetzt der Magic-Link das
-- Zuruecksetzen — wer das Passwort vergisst, meldet sich per Link an und setzt
-- ein neues. Zusammen decken die beiden Wege jeden Einzelverlust ab, ohne dass
-- ein Mensch eingreifen muss.
--
-- Freiwillig: Die Spalte bleibt leer, solange niemand ein Passwort setzt.
-- Gespeichert wird nur der scrypt-Hash im Format "scrypt$N$r$p$salt$hash".
-- =============================================================================

ALTER TABLE "personen" ADD COLUMN "passwortHash" TEXT;

ALTER TABLE "personen" ADD COLUMN "passwortGeaendertAm" TIMESTAMP(3);

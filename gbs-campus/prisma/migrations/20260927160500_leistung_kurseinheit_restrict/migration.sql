-- =============================================================================
-- GBS Campus — Leistung -> Kurseinheit: RESTRICT statt CASCADE
--
-- Befund aus dem Code-Review vom 26.09.2026 (Architektur, INFO): Wurde eine
-- Kurseinheit geloescht, verschwanden mit ihr still die Noten aller Jahrgaenge
-- (ON DELETE CASCADE), waehrend die Termine erhalten blieben (SET NULL). Noten
-- sind Nachweisdaten — wie beim Fach einer Kurseinheit, dem Semester eines
-- Zeugnisses oder dem Termin eines Abrechnungspostens gilt deshalb RESTRICT:
-- Eine Kurseinheit mit Bewertungen laesst sich nicht loeschen. Kurseinheiten
-- werden nur deaktiviert (aktiv = false), nie geloescht.
--
-- Heute gibt es keinen Loeschpfad fuer Kurseinheiten (nur der Seed legt an);
-- die Aenderung sichert einen kuenftigen Kursraster-Editor ab. Die Seite zur
-- Teilnahme bleibt CASCADE (eine Leistung ist ein Kind der Teilnahme).
--
-- Handmigration im Prisma-Stil (DropForeignKey/AddForeignKey mit demselben
-- Namen), deckungsgleich mit `onDelete: Restrict` in schema.prisma.
-- =============================================================================

-- DropForeignKey
ALTER TABLE "leistungen" DROP CONSTRAINT "leistungen_kurseinheitId_fkey";

-- AddForeignKey
ALTER TABLE "leistungen" ADD CONSTRAINT "leistungen_kurseinheitId_fkey" FOREIGN KEY ("kurseinheitId") REFERENCES "kurseinheiten"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

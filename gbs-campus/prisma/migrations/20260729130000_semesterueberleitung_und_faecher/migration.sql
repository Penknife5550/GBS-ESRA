-- Semesterueberleitung (Re-Enrollment) + Kursraster (Grundstein Stundenplan M3).
--
-- Handmigration in Prisma-Namenskonvention: Der Diff (`prisma migrate dev`)
-- laeuft auf diesem Rechner nicht durch (siehe UEBERGABE.md) UND nimmt fuer den
-- partiellen Index `semester_genau_ein_aktuelles` sowie die Append-only-Trigger
-- ungefragt DROP-Statements auf. Diese Migration enthaelt deshalb bewusst NUR
-- die additiven Aenderungen (ADD COLUMN / CREATE TABLE / CREATE INDEX) — keine
-- DROPs. Namen sind so gewaehlt, wie Prisma sie selbst vergaebe.

-- -----------------------------------------------------------------------------
-- 1. Semester: Verortung im Kursraster (Bruecke zum Faechermodell).
--    lehrjahr 1-3, halbjahr 1 = Herbst / 2 = Fruehling. Beide optional.
-- -----------------------------------------------------------------------------
ALTER TABLE "semester" ADD COLUMN "lehrjahr" INTEGER;
ALTER TABLE "semester" ADD COLUMN "halbjahr" INTEGER;

-- -----------------------------------------------------------------------------
-- 2. Teilnahme: Bestaetigungslink der Ueberleitung + Erinnerungsstufen.
--    Nur der Hash des Tokens; der Klartext lebt ausschliesslich in der Mail-URL.
-- -----------------------------------------------------------------------------
ALTER TABLE "teilnahmen" ADD COLUMN "bestaetigungTokenHash" TEXT;
ALTER TABLE "teilnahmen" ADD COLUMN "bestaetigungLaeuftAb" TIMESTAMP(3);
ALTER TABLE "teilnahmen" ADD COLUMN "erinnertStufe1Am" TIMESTAMP(3);
ALTER TABLE "teilnahmen" ADD COLUMN "erinnertStufe2Am" TIMESTAMP(3);
ALTER TABLE "teilnahmen" ADD COLUMN "erinnertStufe3Am" TIMESTAMP(3);

CREATE UNIQUE INDEX "teilnahmen_bestaetigungTokenHash_key" ON "teilnahmen"("bestaetigungTokenHash");

-- Fuer den Aufraeumlauf (entwertet ueber laeuftAb < Grenze) — wie bei magic_links.
CREATE INDEX "teilnahmen_bestaetigungLaeuftAb_idx" ON "teilnahmen"("bestaetigungLaeuftAb");

-- -----------------------------------------------------------------------------
-- 3. Faecher — Referenztabelle des Kursrasters.
-- -----------------------------------------------------------------------------
CREATE TABLE "faecher" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "gesamtstunden" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sortierung" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "faecher_pkey" PRIMARY KEY ("code")
);

-- -----------------------------------------------------------------------------
-- 4. Kurseinheiten — Fach x Lehrjahr x Halbjahr, je Rasterplatz einmalig.
-- -----------------------------------------------------------------------------
CREATE TABLE "kurseinheiten" (
    "id" TEXT NOT NULL,
    "fachCode" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "jahrgangsjahr" INTEGER NOT NULL,
    "halbjahr" INTEGER NOT NULL,
    "stunden" INTEGER,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sortierung" INTEGER NOT NULL DEFAULT 0,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kurseinheiten_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kurseinheiten_fachCode_jahrgangsjahr_halbjahr_key" ON "kurseinheiten"("fachCode", "jahrgangsjahr", "halbjahr");

CREATE INDEX "kurseinheiten_jahrgangsjahr_halbjahr_idx" ON "kurseinheiten"("jahrgangsjahr", "halbjahr");

-- Restrict: ein noch im Raster verwendetes Fach darf nicht geloescht werden.
ALTER TABLE "kurseinheiten"
    ADD CONSTRAINT "kurseinheiten_fachCode_fkey"
    FOREIGN KEY ("fachCode") REFERENCES "faecher"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE;

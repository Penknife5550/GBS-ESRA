-- Honorar-Abrechnung / Auszahlung (M7, Release 0.3).
-- Eine Abrechnung fasst die gehaltenen Abende EINES Dozenten in EINEM Semester
-- zusammen; je Abend ein Posten mit eingefrorenem Datum, Fach und Betrag. Ein
-- Abend fliesst in hoechstens EINE Abrechnung (Posten.terminId UNIQUE).
-- Zwei Schritte: OFFEN -> FREIGEGEBEN (Beleg mit IBAN ans DMS) -> AUSGEZAHLT.
--
-- Handmigration in Prisma-Namenskonvention, rein additiv (CREATE ...), keine
-- DROPs (partieller Index `semester_genau_ein_aktuelles` + Append-only-Trigger).

-- -----------------------------------------------------------------------------
-- Statuswerte der Abrechnung.
-- -----------------------------------------------------------------------------
CREATE TYPE "HonorarAbrechnungStatus" AS ENUM ('OFFEN', 'FREIGEGEBEN', 'AUSGEZAHLT');

-- -----------------------------------------------------------------------------
-- Abrechnung je Dozent x Semester.
-- -----------------------------------------------------------------------------
CREATE TABLE "honorar_abrechnungen" (
    "id" TEXT NOT NULL,
    "dozentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "status" "HonorarAbrechnungStatus" NOT NULL DEFAULT 'OFFEN',
    "summe" INTEGER NOT NULL,
    "belegNr" TEXT,
    "dmsGesendetAm" TIMESTAMP(3),
    "erstelltVonId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freigegebenVonId" TEXT,
    "freigegebenAm" TIMESTAMP(3),
    "ausgezahltVonId" TEXT,
    "ausgezahltAm" DATE,
    "notiz" TEXT,

    CONSTRAINT "honorar_abrechnungen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "honorar_abrechnungen_dozentId_idx" ON "honorar_abrechnungen"("dozentId");
CREATE INDEX "honorar_abrechnungen_semesterId_status_idx" ON "honorar_abrechnungen"("semesterId", "status");

ALTER TABLE "honorar_abrechnungen"
    ADD CONSTRAINT "honorar_abrechnungen_dozentId_fkey"
    FOREIGN KEY ("dozentId") REFERENCES "personen"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "honorar_abrechnungen"
    ADD CONSTRAINT "honorar_abrechnungen_semesterId_fkey"
    FOREIGN KEY ("semesterId") REFERENCES "semester"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Posten: ein abgerechneter Abend, eingefroren. terminId UNIQUE -> kein
-- Doppel-Honorar; Cascade an der Abrechnung, Restrict am Termin.
-- -----------------------------------------------------------------------------
CREATE TABLE "honorar_abrechnung_posten" (
    "id" TEXT NOT NULL,
    "abrechnungId" TEXT NOT NULL,
    "terminId" TEXT NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL,
    "fach" TEXT,
    "betrag" INTEGER NOT NULL,

    CONSTRAINT "honorar_abrechnung_posten_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "honorar_abrechnung_posten_terminId_key" ON "honorar_abrechnung_posten"("terminId");
CREATE INDEX "honorar_abrechnung_posten_abrechnungId_idx" ON "honorar_abrechnung_posten"("abrechnungId");

ALTER TABLE "honorar_abrechnung_posten"
    ADD CONSTRAINT "honorar_abrechnung_posten_abrechnungId_fkey"
    FOREIGN KEY ("abrechnungId") REFERENCES "honorar_abrechnungen"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "honorar_abrechnung_posten"
    ADD CONSTRAINT "honorar_abrechnung_posten_terminId_fkey"
    FOREIGN KEY ("terminId") REFERENCES "unterrichtstermine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

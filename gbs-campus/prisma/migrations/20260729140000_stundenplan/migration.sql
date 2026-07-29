-- Stundenplan & Anwesenheit (M3): Unterrichtstermine je Semester und die
-- Anwesenheit je Teilnahme und Termin.
--
-- Handmigration im Prisma-Stil (der Diff laeuft auf diesem Rechner nicht durch;
-- ausserdem nimmt `prisma migrate dev` DROPs fuer den partiellen Index
-- `semester_genau_ein_aktuelles` und die Append-only-Trigger auf). Nur additive
-- Anweisungen, keine DROPs. Namen wie von Prisma vergeben.

-- -----------------------------------------------------------------------------
-- 1. Enum der Anwesenheits-Stati.
-- -----------------------------------------------------------------------------
CREATE TYPE "Anwesenheitsstatus" AS ENUM ('ANWESEND', 'ENTSCHULDIGT', 'GEFEHLT', 'NACHGEARBEITET');

-- -----------------------------------------------------------------------------
-- 2. Unterrichtstermine — die Abende eines Semesters.
-- -----------------------------------------------------------------------------
CREATE TABLE "unterrichtstermine" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "kurseinheitId" TEXT,
    "beginn" TIMESTAMP(3) NOT NULL,
    "ende" TIMESTAMP(3),
    "thema" TEXT,
    "reihenfolge" INTEGER NOT NULL DEFAULT 0,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unterrichtstermine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "unterrichtstermine_semesterId_beginn_idx" ON "unterrichtstermine"("semesterId", "beginn");

-- Cascade: mit dem Semester verschwinden seine Termine.
ALTER TABLE "unterrichtstermine"
    ADD CONSTRAINT "unterrichtstermine_semesterId_fkey"
    FOREIGN KEY ("semesterId") REFERENCES "semester"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: eine geloeschte Kurseinheit reisst den Termin nicht mit.
ALTER TABLE "unterrichtstermine"
    ADD CONSTRAINT "unterrichtstermine_kurseinheitId_fkey"
    FOREIGN KEY ("kurseinheitId") REFERENCES "kurseinheiten"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Anwesenheit — je Teilnahme und Termin genau eine Zeile.
-- -----------------------------------------------------------------------------
CREATE TABLE "anwesenheiten" (
    "id" TEXT NOT NULL,
    "terminId" TEXT NOT NULL,
    "teilnahmeId" TEXT NOT NULL,
    "status" "Anwesenheitsstatus" NOT NULL,
    "notiz" TEXT,
    "erfasstVonId" TEXT,
    "erfasstAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anwesenheiten_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anwesenheiten_terminId_teilnahmeId_key" ON "anwesenheiten"("terminId", "teilnahmeId");

CREATE INDEX "anwesenheiten_teilnahmeId_idx" ON "anwesenheiten"("teilnahmeId");

-- Cascade auf beiden Seiten: Anwesenheit ist ein Kind von Termin UND Teilnahme.
ALTER TABLE "anwesenheiten"
    ADD CONSTRAINT "anwesenheiten_terminId_fkey"
    FOREIGN KEY ("terminId") REFERENCES "unterrichtstermine"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "anwesenheiten"
    ADD CONSTRAINT "anwesenheiten_teilnahmeId_fkey"
    FOREIGN KEY ("teilnahmeId") REFERENCES "teilnahmen"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

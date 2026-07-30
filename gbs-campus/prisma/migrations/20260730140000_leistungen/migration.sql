-- Leistungen & Noten (M8, Release 0.4, Stufe 1): eine Bewertung je Teilnahme und
-- Kurseinheit. Bewertung ist flexibel — Pflicht ist nur das `ergebnis`, `punkte`
-- und `note` sind optional (nur Bibelkunde wird real benotet, der Rest verbal).
--
-- Handmigration im Prisma-Stil (der Diff laeuft auf diesem Rechner nicht durch;
-- ausserdem nimmt `prisma migrate dev` DROPs fuer den partiellen Index
-- `semester_genau_ein_aktuelles` und die Append-only-Trigger auf). Nur additive
-- Anweisungen, keine DROPs. Namen wie von Prisma vergeben.

-- -----------------------------------------------------------------------------
-- 1. Enum der Leistungsergebnisse.
-- -----------------------------------------------------------------------------
CREATE TYPE "Leistungsergebnis" AS ENUM ('TEILGENOMMEN', 'ERFOLGREICH_TEILGENOMMEN', 'BESTANDEN', 'NICHT_BESTANDEN');

-- -----------------------------------------------------------------------------
-- 2. Leistungen — je Teilnahme und Kurseinheit genau eine Zeile.
-- -----------------------------------------------------------------------------
CREATE TABLE "leistungen" (
    "id" TEXT NOT NULL,
    "teilnahmeId" TEXT NOT NULL,
    "kurseinheitId" TEXT NOT NULL,
    "ergebnis" "Leistungsergebnis" NOT NULL,
    "punkte" INTEGER,
    "note" TEXT,
    "erfasstVonId" TEXT,
    "erfasstAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leistungen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leistungen_teilnahmeId_kurseinheitId_key" ON "leistungen"("teilnahmeId", "kurseinheitId");

CREATE INDEX "leistungen_kurseinheitId_idx" ON "leistungen"("kurseinheitId");

-- Cascade auf beiden Seiten: eine Leistung ist ein Kind von Teilnahme UND
-- Kurseinheit — wie die Anwesenheit (Kind von Termin UND Teilnahme).
ALTER TABLE "leistungen"
    ADD CONSTRAINT "leistungen_teilnahmeId_fkey"
    FOREIGN KEY ("teilnahmeId") REFERENCES "teilnahmen"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leistungen"
    ADD CONSTRAINT "leistungen_kurseinheitId_fkey"
    FOREIGN KEY ("kurseinheitId") REFERENCES "kurseinheiten"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

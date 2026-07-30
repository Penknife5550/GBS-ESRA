-- Dozentenhonorar: Satz-Historie (M7, Release 0.3, erster Slice).
-- Statt eines einzigen Satzes (der vergangene Abende rueckwirkend neu bewertet
-- haette) fuehrt der Honorarsatz eine Historie mit Gueltig-ab-Datum: jeder Abend
-- nimmt den Satz, der zu seinem Datum galt. Das Eintragen durch eine berechtigte
-- Person ist die Genehmigung (genehmigtVonId/genehmigtAm); nach jeder Genehmigung
-- geht ein Beleg ans DMS (dmsBelegNr/dmsGesendetAm).
--
-- Handmigration in Prisma-Namenskonvention und rein additiv (nur CREATE) — keine
-- DROPs. Grund wie bei den bisherigen Handmigrationen: `prisma migrate dev`
-- nimmt fuer den partiellen Index `semester_genau_ein_aktuelles` und die
-- Append-only-Trigger ungefragt DROP-Statements auf.

-- -----------------------------------------------------------------------------
-- honorar_saetze: eine Zeile je genehmigtem Satz. Kein UNIQUE auf gueltigAb —
-- Korrekturen sind neue Zeilen; die Aufloesung nimmt bei gleichem Datum die
-- zuletzt genehmigte Zeile.
-- -----------------------------------------------------------------------------
CREATE TABLE "honorar_saetze" (
    "id" TEXT NOT NULL,
    "betrag" INTEGER NOT NULL,
    "gueltigAb" TIMESTAMP(3) NOT NULL,
    "notiz" TEXT,
    "genehmigtVonId" TEXT,
    "genehmigtAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dmsBelegNr" TEXT,
    "dmsGesendetAm" TIMESTAMP(3),

    CONSTRAINT "honorar_saetze_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "honorar_saetze_gueltigAb_idx" ON "honorar_saetze"("gueltigAb");

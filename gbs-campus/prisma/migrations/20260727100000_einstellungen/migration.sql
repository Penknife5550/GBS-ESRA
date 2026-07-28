-- CreateEnum
CREATE TYPE "EinstellungTyp" AS ENUM ('ZAHL', 'TEXT', 'JA_NEIN');

-- CreateTable
CREATE TABLE "einstellungen" (
    "schluessel" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "bereich" TEXT NOT NULL,
    "typ" "EinstellungTyp" NOT NULL,
    "wert" TEXT NOT NULL,
    "minimum" INTEGER,
    "maximum" INTEGER,
    "einheit" TEXT,
    "sortierung" INTEGER NOT NULL DEFAULT 0,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "einstellungen_pkey" PRIMARY KEY ("schluessel")
);

-- CreateIndex
CREATE INDEX "einstellungen_bereich_sortierung_idx" ON "einstellungen"("bereich", "sortierung");


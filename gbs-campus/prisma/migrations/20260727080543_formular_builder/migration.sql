/*
  Warnings:

  - You are about to drop the column `formularVersion` on the `anmeldungen` table. All the data in the column will be lost.
  - Added the required column `formularVersionId` to the `anmeldungen` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FormularVersionStatus" AS ENUM ('ENTWURF', 'VEROEFFENTLICHT', 'ARCHIVIERT');

-- CreateEnum
CREATE TYPE "FeldTyp" AS ENUM ('TEXT', 'MEHRZEILIG', 'EMAIL', 'TELEFON', 'DATUM', 'ZAHL', 'AUSWAHL_EINFACH', 'AUSWAHL_MEHRFACH', 'JA_NEIN', 'IBAN', 'HINWEIS');

-- CreateEnum
CREATE TYPE "PersonFeld" AS ENUM ('NICHTS', 'VORNAME', 'NACHNAME', 'EMAIL', 'TELEFON', 'GEBURTSDATUM', 'STRASSE', 'PLZ', 'ORT', 'GEMEINDE', 'IBAN', 'KONTOINHABER', 'TEILNAHMEFORM');

-- AlterTable
ALTER TABLE "anmeldungen" DROP COLUMN "formularVersion",
ADD COLUMN     "formularVersionId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "formulare" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formular_versionen" (
    "id" TEXT NOT NULL,
    "formularId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FormularVersionStatus" NOT NULL DEFAULT 'ENTWURF',
    "einleitung" TEXT,
    "veroeffentlichtAm" TIMESTAMP(3),
    "veroeffentlichtVonId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formular_versionen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formular_abschnitte" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "beschreibung" TEXT,
    "reihenfolge" INTEGER NOT NULL,

    CONSTRAINT "formular_abschnitte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formular_felder" (
    "id" TEXT NOT NULL,
    "abschnittId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "typ" "FeldTyp" NOT NULL,
    "label" TEXT NOT NULL,
    "hilfetext" TEXT,
    "platzhalter" TEXT,
    "pflicht" BOOLEAN NOT NULL DEFAULT false,
    "reihenfolge" INTEGER NOT NULL,
    "optionen" JSONB,
    "personFeld" "PersonFeld" NOT NULL DEFAULT 'NICHTS',
    "istArt9" BOOLEAN NOT NULL DEFAULT false,
    "validierung" JSONB,

    CONSTRAINT "formular_felder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formulare_code_key" ON "formulare"("code");

-- CreateIndex
CREATE INDEX "formular_versionen_status_idx" ON "formular_versionen"("status");

-- CreateIndex
CREATE UNIQUE INDEX "formular_versionen_formularId_version_key" ON "formular_versionen"("formularId", "version");

-- CreateIndex
CREATE INDEX "formular_abschnitte_versionId_reihenfolge_idx" ON "formular_abschnitte"("versionId", "reihenfolge");

-- CreateIndex
CREATE INDEX "formular_felder_abschnittId_reihenfolge_idx" ON "formular_felder"("abschnittId", "reihenfolge");

-- CreateIndex
CREATE UNIQUE INDEX "formular_felder_abschnittId_code_key" ON "formular_felder"("abschnittId", "code");

-- AddForeignKey
ALTER TABLE "anmeldungen" ADD CONSTRAINT "anmeldungen_formularVersionId_fkey" FOREIGN KEY ("formularVersionId") REFERENCES "formular_versionen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formular_versionen" ADD CONSTRAINT "formular_versionen_formularId_fkey" FOREIGN KEY ("formularId") REFERENCES "formulare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formular_abschnitte" ADD CONSTRAINT "formular_abschnitte_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "formular_versionen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formular_felder" ADD CONSTRAINT "formular_felder_abschnittId_fkey" FOREIGN KEY ("abschnittId") REFERENCES "formular_abschnitte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

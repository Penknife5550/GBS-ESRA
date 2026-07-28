-- CreateEnum
CREATE TYPE "Teilnahmeform" AS ENUM ('SCHUELER', 'HOERER');

-- CreateEnum
CREATE TYPE "AnmeldungStatus" AS ENUM ('ENTWURF', 'EINGEREICHT', 'ANGENOMMEN', 'ABGELEHNT');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('WARTEND', 'GESENDET', 'FEHLER', 'BOUNCE');

-- CreateTable
CREATE TABLE "teilnehmer_status" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "istAktiv" BOOLEAN NOT NULL DEFAULT false,
    "istTerminal" BOOLEAN NOT NULL DEFAULT false,
    "beitragLaeuft" BOOLEAN NOT NULL DEFAULT false,
    "anwesenheitZaehlt" BOOLEAN NOT NULL DEFAULT false,
    "automatikMails" BOOLEAN NOT NULL DEFAULT false,
    "sortierung" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "teilnehmer_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "status_wechsel" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "vonCode" TEXT,
    "nachCode" TEXT NOT NULL,
    "grund" TEXT,
    "ausgeloestVonId" TEXT,
    "automatisch" BOOLEAN NOT NULL DEFAULT false,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_wechsel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rollen" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "aktivAbRelease" TEXT NOT NULL DEFAULT '0.1',
    "sortierung" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rollen_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "rechte" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "bereich" TEXT NOT NULL,

    CONSTRAINT "rechte_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "rolle_recht" (
    "rolleCode" TEXT NOT NULL,
    "rechtCode" TEXT NOT NULL,

    CONSTRAINT "rolle_recht_pkey" PRIMARY KEY ("rolleCode","rechtCode")
);

-- CreateTable
CREATE TABLE "person_rolle" (
    "personId" TEXT NOT NULL,
    "rolleCode" TEXT NOT NULL,
    "erteiltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erteiltVonId" TEXT,

    CONSTRAINT "person_rolle_pkey" PRIMARY KEY ("personId","rolleCode")
);

-- CreateTable
CREATE TABLE "personen" (
    "id" TEXT NOT NULL,
    "vorname" TEXT NOT NULL,
    "nachname" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefon" TEXT,
    "geburtsdatum" DATE,
    "strasse" TEXT,
    "plz" TEXT,
    "ort" TEXT,
    "ibanVerschluesselt" TEXT,
    "kontoinhaber" TEXT,
    "gemeinde" TEXT,
    "statusCode" TEXT NOT NULL DEFAULT 'INTERESSENT',
    "teilnahmeform" "Teilnahmeform",
    "notiz" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semester" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "ende" DATE NOT NULL,
    "anmeldungVon" DATE,
    "anmeldungBis" DATE,
    "istAktuell" BOOLEAN NOT NULL DEFAULT false,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teilnahmen" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "teilnahmeform" "Teilnahmeform" NOT NULL,
    "bestaetigtAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teilnahmen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anmeldungen" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "status" "AnmeldungStatus" NOT NULL DEFAULT 'ENTWURF',
    "antworten" JSONB NOT NULL,
    "formularVersion" TEXT NOT NULL,
    "teilnahmeform" "Teilnahmeform",
    "fortsetzenTokenHash" TEXT,
    "fortsetzenLaeuftAb" TIMESTAMP(3),
    "eingereichtAm" TIMESTAMP(3),
    "entschiedenAm" TIMESTAMP(3),
    "entschiedenVonId" TEXT,
    "ablehnungsgrund" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anmeldungen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einwilligungs_texte" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "titel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "istArt9" BOOLEAN NOT NULL DEFAULT false,
    "pflicht" BOOLEAN NOT NULL DEFAULT true,
    "aktivAb" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktivBis" TIMESTAMP(3),

    CONSTRAINT "einwilligungs_texte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einwilligungen" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "anmeldungId" TEXT,
    "textId" TEXT NOT NULL,
    "erteilt" BOOLEAN NOT NULL,
    "zeitpunkt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAdresse" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "einwilligungen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "laeuftAb" TIMESTAMP(3) NOT NULL,
    "benutztAm" TIMESTAMP(3),
    "angefordertVonIp" TEXT,
    "userAgent" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "schluessel" TEXT NOT NULL,
    "zeitpunkt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_vorlagen" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "betreff" TEXT NOT NULL,
    "textMd" TEXT NOT NULL,
    "beschreibung" TEXT,
    "istSystem" BOOLEAN NOT NULL DEFAULT true,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_vorlagen_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "email_versand" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "empfaenger" TEXT NOT NULL,
    "betreff" TEXT NOT NULL,
    "vorlageCode" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'WARTEND',
    "fehler" TEXT,
    "gesendetAm" TIMESTAMP(3),
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_versand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "akteurId" TEXT,
    "aktion" TEXT NOT NULL,
    "quelle" TEXT NOT NULL DEFAULT 'WEB',
    "objektTyp" TEXT NOT NULL,
    "objektId" TEXT,
    "vorher" JSONB,
    "nachher" JSONB,
    "ipAdresse" TEXT,
    "userAgent" TEXT,
    "impersoniertPersonId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_wechsel_personId_erstelltAm_idx" ON "status_wechsel"("personId", "erstelltAm");

-- CreateIndex
CREATE UNIQUE INDEX "personen_email_key" ON "personen"("email");

-- CreateIndex
CREATE INDEX "personen_statusCode_idx" ON "personen"("statusCode");

-- CreateIndex
CREATE INDEX "personen_nachname_vorname_idx" ON "personen"("nachname", "vorname");

-- CreateIndex
CREATE UNIQUE INDEX "semester_code_key" ON "semester"("code");

-- CreateIndex
CREATE INDEX "teilnahmen_semesterId_idx" ON "teilnahmen"("semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "teilnahmen_personId_semesterId_key" ON "teilnahmen"("personId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "anmeldungen_personId_key" ON "anmeldungen"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "anmeldungen_fortsetzenTokenHash_key" ON "anmeldungen"("fortsetzenTokenHash");

-- CreateIndex
CREATE INDEX "anmeldungen_status_idx" ON "anmeldungen"("status");

-- CreateIndex
CREATE UNIQUE INDEX "einwilligungs_texte_code_version_key" ON "einwilligungs_texte"("code", "version");

-- CreateIndex
CREATE INDEX "einwilligungen_personId_idx" ON "einwilligungen"("personId");

-- CreateIndex
CREATE INDEX "einwilligungen_anmeldungId_idx" ON "einwilligungen"("anmeldungId");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_tokenHash_key" ON "magic_links"("tokenHash");

-- CreateIndex
CREATE INDEX "magic_links_personId_idx" ON "magic_links"("personId");

-- CreateIndex
CREATE INDEX "magic_links_laeuftAb_idx" ON "magic_links"("laeuftAb");

-- CreateIndex
CREATE INDEX "rate_limit_schluessel_zeitpunkt_idx" ON "rate_limit"("schluessel", "zeitpunkt");

-- CreateIndex
CREATE INDEX "email_versand_personId_idx" ON "email_versand"("personId");

-- CreateIndex
CREATE INDEX "email_versand_status_idx" ON "email_versand"("status");

-- CreateIndex
CREATE INDEX "audit_log_akteurId_idx" ON "audit_log"("akteurId");

-- CreateIndex
CREATE INDEX "audit_log_objektTyp_objektId_idx" ON "audit_log"("objektTyp", "objektId");

-- CreateIndex
CREATE INDEX "audit_log_erstelltAm_idx" ON "audit_log"("erstelltAm");

-- AddForeignKey
ALTER TABLE "status_wechsel" ADD CONSTRAINT "status_wechsel_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_wechsel" ADD CONSTRAINT "status_wechsel_vonCode_fkey" FOREIGN KEY ("vonCode") REFERENCES "teilnehmer_status"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_wechsel" ADD CONSTRAINT "status_wechsel_nachCode_fkey" FOREIGN KEY ("nachCode") REFERENCES "teilnehmer_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_wechsel" ADD CONSTRAINT "status_wechsel_ausgeloestVonId_fkey" FOREIGN KEY ("ausgeloestVonId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolle_recht" ADD CONSTRAINT "rolle_recht_rolleCode_fkey" FOREIGN KEY ("rolleCode") REFERENCES "rollen"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolle_recht" ADD CONSTRAINT "rolle_recht_rechtCode_fkey" FOREIGN KEY ("rechtCode") REFERENCES "rechte"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_rolle" ADD CONSTRAINT "person_rolle_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_rolle" ADD CONSTRAINT "person_rolle_rolleCode_fkey" FOREIGN KEY ("rolleCode") REFERENCES "rollen"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personen" ADD CONSTRAINT "personen_statusCode_fkey" FOREIGN KEY ("statusCode") REFERENCES "teilnehmer_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teilnahmen" ADD CONSTRAINT "teilnahmen_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teilnahmen" ADD CONSTRAINT "teilnahmen_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semester"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anmeldungen" ADD CONSTRAINT "anmeldungen_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einwilligungen" ADD CONSTRAINT "einwilligungen_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einwilligungen" ADD CONSTRAINT "einwilligungen_anmeldungId_fkey" FOREIGN KEY ("anmeldungId") REFERENCES "anmeldungen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einwilligungen" ADD CONSTRAINT "einwilligungen_textId_fkey" FOREIGN KEY ("textId") REFERENCES "einwilligungs_texte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_versand" ADD CONSTRAINT "email_versand_personId_fkey" FOREIGN KEY ("personId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_akteurId_fkey" FOREIGN KEY ("akteurId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

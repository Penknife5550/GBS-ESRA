-- Zeugnisse & Bescheinigungen (M8, Release 0.4, Stufe 2): ein eingefrorenes
-- Dokument je Ausstellung (Snapshot als JSON). Drei Typen (Semester-Zeugnis,
-- Abschlusszeugnis, Teilnahmebescheinigung), Korrektur per Neuausstellung/Storno.
--
-- Handmigration im Prisma-Stil (der Diff laeuft auf diesem Rechner nicht durch;
-- ausserdem nimmt `prisma migrate dev` DROPs fuer den partiellen Index
-- `semester_genau_ein_aktuelles`, den unten neu angelegten `zeugnis_ein_gueltiges`
-- und die Append-only-Trigger auf). Nur additive Anweisungen, keine DROPs. Namen
-- wie von Prisma vergeben.

-- -----------------------------------------------------------------------------
-- 1. Enums.
-- -----------------------------------------------------------------------------
CREATE TYPE "Zeugnistyp" AS ENUM ('SEMESTER', 'ABSCHLUSS', 'BESCHEINIGUNG');
CREATE TYPE "Zeugnisstatus" AS ENUM ('GUELTIG', 'ERSETZT');

-- -----------------------------------------------------------------------------
-- 2. Zeugnisse.
-- -----------------------------------------------------------------------------
CREATE TABLE "zeugnisse" (
    "id" TEXT NOT NULL,
    "belegNr" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "typ" "Zeugnistyp" NOT NULL,
    "status" "Zeugnisstatus" NOT NULL DEFAULT 'GUELTIG',
    "version" INTEGER NOT NULL DEFAULT 1,
    "ersetztId" TEXT,
    "snapshot" JSONB NOT NULL,
    "ausgestelltVonId" TEXT,
    "ausgestelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dmsGesendetAm" TIMESTAMP(3),

    CONSTRAINT "zeugnisse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zeugnisse_belegNr_key" ON "zeugnisse"("belegNr");

CREATE INDEX "zeugnisse_semesterId_typ_status_idx" ON "zeugnisse"("semesterId", "typ", "status");

CREATE INDEX "zeugnisse_personId_status_idx" ON "zeugnisse"("personId", "status");

-- Hoechstens EIN gueltiges Zeugnis je (Person, Semester, Typ). Partieller
-- Unique-Index (in Prisma nicht ausdrueckbar, deshalb hier von Hand) — er sichert
-- die Storno-Invariante auch gegen zwei nahezu gleichzeitige Ausstellungen:
-- der zweite Insert eines GUELTIG-Zeugnisses laeuft in die Unique-Verletzung.
-- ACHTUNG wie bei `semester_genau_ein_aktuelles`: `prisma migrate dev` wuerde ihn
-- als „nicht im Schema" sehen und ein DROP INDEX erzeugen — beim naechsten
-- erzeugten Diff entfernen.
CREATE UNIQUE INDEX "zeugnis_ein_gueltiges" ON "zeugnisse"("personId", "semesterId", "typ") WHERE "status" = 'GUELTIG';

-- Das Abschlusszeugnis ist je PERSON eindeutig (nicht je Semester) — sein Inhalt
-- aggregiert die ganze Ausbildung. Ohne diesen zweiten partiellen Index koennte
-- ein Ausstell-Lauf in einem anderen Semester ein ZWEITES gueltiges
-- Abschlusszeugnis anlegen (der obige Index scoped auf semesterId, greift also
-- nicht). Auch dieser Index ist in Prisma nicht ausdrueckbar — bei einem
-- kuenftigen `migrate dev`-Diff das erzeugte DROP entfernen.
CREATE UNIQUE INDEX "zeugnis_ein_abschluss" ON "zeugnisse"("personId") WHERE "status" = 'GUELTIG' AND "typ" = 'ABSCHLUSS';

-- Cascade: mit der Person verschwinden ihre Zeugnisse (echtes Loeschen; die
-- Anonymisierung nach Art. 17 loescht nicht, sondern scrubbt — siehe Backlog).
ALTER TABLE "zeugnisse"
    ADD CONSTRAINT "zeugnisse_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "personen"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: ein Zeugnis darf sein Ausstellungs-Semester nicht verlieren (wie die
-- Honorar-Abrechnung).
ALTER TABLE "zeugnisse"
    ADD CONSTRAINT "zeugnisse_semesterId_fkey"
    FOREIGN KEY ("semesterId") REFERENCES "semester"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

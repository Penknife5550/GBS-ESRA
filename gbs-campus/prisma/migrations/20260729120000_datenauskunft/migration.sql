-- Auskunftsverlangen nach DSGVO Art. 15: Zugangsberechtigung (Token) fuer den
-- sicheren Abruf einer Datenkopie. Nur der Hash des Tokens wird gespeichert.
-- Namen bewusst so gewaehlt, wie Prisma sie selbst vergaebe (der Diff laeuft auf
-- diesem Rechner nicht durch — siehe UEBERGABE.md).

CREATE TABLE "datenauskuenfte" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "laeuftAb" TIMESTAMP(3) NOT NULL,
    "abgerufenAm" TIMESTAMP(3),
    "erstelltVonId" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "datenauskuenfte_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "datenauskuenfte_tokenHash_key" ON "datenauskuenfte"("tokenHash");

CREATE INDEX "datenauskuenfte_personId_idx" ON "datenauskuenfte"("personId");

-- Fuer den Aufraeumlauf (loescht ueber laeuftAb < Grenze) — wie bei
-- magic_links und email_aenderungen.
CREATE INDEX "datenauskuenfte_laeuftAb_idx" ON "datenauskuenfte"("laeuftAb");

-- Cascade: Faellt die Person weg, ist ein offenes Auskunftsverlangen
-- gegenstandslos. Der Nachweis, DASS eine Auskunft erteilt wurde, steht
-- unabhaengig davon im append-only Audit-Log.
ALTER TABLE "datenauskuenfte"
    ADD CONSTRAINT "datenauskuenfte_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "personen"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

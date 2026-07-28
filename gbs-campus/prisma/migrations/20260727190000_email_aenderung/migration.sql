-- =============================================================================
-- Bestaetigte Aenderung der E-Mail-Adresse
--
-- Die Adresse ist der einzige Kontoschluessel (Magic-Link, kein Passwort).
-- Eine sofort wirksame Selbstpflege wuerde bei einem Tippfehler das Konto
-- dauerhaft aussperren — deshalb wird die Aenderung erst wirksam, wenn der Link
-- an die NEUE Adresse eingeloest ist.
--
-- Nur der SHA-256-Hash des Tokens wird gespeichert, wie beim Magic-Link.
-- =============================================================================

CREATE TABLE "email_aenderungen" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "neueEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "laeuftAb" TIMESTAMP(3) NOT NULL,
    "benutztAm" TIMESTAMP(3),
    "angefordertVonIp" TEXT,
    "userAgent" TEXT,
    "erstelltAm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_aenderungen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_aenderungen_tokenHash_key" ON "email_aenderungen"("tokenHash");

CREATE INDEX "email_aenderungen_personId_idx" ON "email_aenderungen"("personId");

CREATE INDEX "email_aenderungen_laeuftAb_idx" ON "email_aenderungen"("laeuftAb");

ALTER TABLE "email_aenderungen"
  ADD CONSTRAINT "email_aenderungen_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "personen"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

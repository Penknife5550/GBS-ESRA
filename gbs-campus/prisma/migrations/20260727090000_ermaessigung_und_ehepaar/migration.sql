-- AlterTable
ALTER TABLE "personen" ADD COLUMN     "ehepartnerId" TEXT,
ADD COLUMN     "ermaessigungCode" TEXT;

-- CreateTable
CREATE TABLE "ermaessigungen" (
    "code" TEXT NOT NULL,
    "bezeichnung" TEXT NOT NULL,
    "beschreibung" TEXT,
    "prozent" INTEGER NOT NULL,
    "aktiv" BOOLEAN NOT NULL DEFAULT true,
    "sortierung" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ermaessigungen_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "personen_ehepartnerId_key" ON "personen"("ehepartnerId");

-- AddForeignKey
ALTER TABLE "personen" ADD CONSTRAINT "personen_ehepartnerId_fkey" FOREIGN KEY ("ehepartnerId") REFERENCES "personen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personen" ADD CONSTRAINT "personen_ermaessigungCode_fkey" FOREIGN KEY ("ermaessigungCode") REFERENCES "ermaessigungen"("code") ON DELETE SET NULL ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Handergaenzung: niemand ist mit sich selbst verheiratet.
--
-- Der Unique-Index oben verhindert, dass zwei Personen auf denselben Partner
-- zeigen. Er verhindert aber nicht die Selbstreferenz — und die wuerde im
-- Beitragslauf ab Release 0.3 zu einer Ermaessigung fuehren, der kein zweiter
-- Beitrag gegenuebersteht.
--
-- Die Wechselseitigkeit (A zeigt auf B UND B auf A) setzt die Anwendung in
-- einer Transaktion; sie laesst sich ohne rekursionsanfaelligen Trigger nicht
-- sinnvoll in der Datenbank erzwingen.
-- -----------------------------------------------------------------------------
ALTER TABLE "personen"
  ADD CONSTRAINT "personen_ehepartner_nicht_selbst"
  CHECK ("ehepartnerId" IS NULL OR "ehepartnerId" <> "id");

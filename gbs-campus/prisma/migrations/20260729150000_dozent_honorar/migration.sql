-- Dozentenhonorar (M7-Grundstein, Release 0.2): ein Termin kann einem Dozenten
-- zugeordnet werden. Aus „Anzahl Abende je Dozent x Honorarsatz" ergibt sich die
-- read-only Honorar-Uebersicht. Die eigentliche Abrechnung folgt in 0.3.
--
-- Handmigration in Prisma-Namenskonvention: Der Diff (`prisma migrate dev`)
-- laeuft auf diesem Rechner nicht durch UND nimmt fuer den partiellen Index
-- `semester_genau_ein_aktuelles` sowie die Append-only-Trigger ungefragt
-- DROP-Statements auf. Diese Migration enthaelt deshalb bewusst NUR die additive
-- Aenderung (ADD COLUMN / CREATE INDEX / ADD CONSTRAINT) — keine DROPs. Namen
-- sind so gewaehlt, wie Prisma sie selbst vergaebe.

-- -----------------------------------------------------------------------------
-- Unterrichtstermin: Dozentenzuordnung.
--    SetNull: ein geloeschtes Dozentenkonto reisst den Abend nicht mit — die
--    Zuordnung faellt weg, der Termin bleibt bestehen.
-- -----------------------------------------------------------------------------
ALTER TABLE "unterrichtstermine" ADD COLUMN "dozentId" TEXT;

CREATE INDEX "unterrichtstermine_dozentId_idx" ON "unterrichtstermine"("dozentId");

ALTER TABLE "unterrichtstermine"
    ADD CONSTRAINT "unterrichtstermine_dozentId_fkey"
    FOREIGN KEY ("dozentId") REFERENCES "personen"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

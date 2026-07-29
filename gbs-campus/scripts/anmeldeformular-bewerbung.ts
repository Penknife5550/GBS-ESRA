/**
 * Spielt das "Bewerbungsformular GBS-Minden" (6 Abschnitte, 30 Felder) als NEUE
 * veroeffentlichte Fassung gegen eine laufende Datenbank ein und archiviert die
 * bisher veroeffentlichte. Die Felddefinition liegt in
 * `../prisma/anmeldeformular-definition.ts` — dieselbe Quelle, aus der auch der
 * Seed die Startfassung anlegt. Dieses Skript ist der manuelle Nachtrag-Weg fuer
 * eine bereits laufende Instanz (der Seed beruehrt eine bestehende Fassung nie).
 *
 * AUSFUEHREN (nicht Teil des Produktions-Images) gegen eine laufende DB, aus dem
 * Builder-Image, weil lokal tsx/prisma an den Sync-Diensten haengen:
 *   docker run -i --rm -e DATABASE_URL="postgresql://gbs:...@host.docker.internal:5434/gbs_campus" \
 *     gbs-campus-builder:local sh -c "cat > /app/f.ts && npx tsx /app/f.ts" < scripts/anmeldeformular-bewerbung.ts
 */
import { PrismaClient } from "@prisma/client";
import { ABSCHNITTE, EINLEITUNG } from "../prisma/anmeldeformular-definition";

const prisma = new PrismaClient();

async function main() {
  const formular = await prisma.formular.findFirstOrThrow({ where: { code: "ANMELDUNG" } });
  const letzte = await prisma.formularVersion.findFirst({
    where: { formularId: formular.id },
    orderBy: { version: "desc" },
  });
  const neueVersion = (letzte?.version ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.formularVersion.updateMany({
      where: { formularId: formular.id, status: "VEROEFFENTLICHT" },
      data: { status: "ARCHIVIERT" },
    });

    await tx.formularVersion.create({
      data: {
        formularId: formular.id,
        version: neueVersion,
        status: "VEROEFFENTLICHT",
        einleitung: EINLEITUNG,
        veroeffentlichtAm: new Date(),
        abschnitte: {
          create: ABSCHNITTE.map((abschnitt, ai) => ({
            titel: abschnitt.titel,
            beschreibung: abschnitt.beschreibung,
            reihenfolge: ai,
            felder: {
              create: abschnitt.felder.map((feld, fi) => ({
                code: feld.code,
                typ: feld.typ as never,
                label: feld.label,
                hilfetext: feld.hilfetext ?? null,
                pflicht: feld.pflicht,
                reihenfolge: fi,
                optionen: feld.optionen ?? undefined,
                personFeld: (feld.personFeld ?? "NICHTS") as never,
                istArt9: Boolean(feld.istArt9),
                validierung: feld.teilnahmeformZuordnung ? { teilnahmeform: feld.teilnahmeformZuordnung } : undefined,
              })),
            },
          })),
        },
      },
    });
  });

  const felder = ABSCHNITTE.reduce((s, a) => s + a.felder.length, 0);
  console.log(`OK: Fassung ${neueVersion} veroeffentlicht — ${ABSCHNITTE.length} Abschnitte, ${felder} Felder.`);
}

main()
  .catch((f) => {
    console.error(f);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Gegenprobe für die Einstellungen.
 * Aufruf: npx tsx scripts/pruefe-einstellungen.ts  (braucht die Datenbank)
 *
 * **Dieses Skript schreibt in die Datenbank.** Es setzt einen Einstellungswert
 * um, macht ihn absichtlich kaputt und löscht die Zeile am Ende sogar — deshalb
 * läuft es nur gegen eine örtliche Datenbank (siehe `pruefeDatenbank`), und die
 * Wiederherstellung steht in einem `finally`.
 */

import { PrismaClient } from "@prisma/client";
import { EINSTELLUNGEN, istEinstellungSchluessel, setzeZahl, zahl } from "../src/lib/einstellungen";
import { gueltigkeitAlsText } from "../src/lib/magic-link";

const prisma = new PrismaClient();

/**
 * Schutzabfrage vor dem ersten Schreibzugriff.
 *
 * Der Ablauf unten löscht eine Zeile in `einstellungen` und legt sie neu an. Auf
 * einer Produktionsdatenbank wäre das ein Eingriff im laufenden Betrieb — und
 * ein `DATABASE_URL` aus der falschen Shell ist schneller passiert, als einem
 * lieb ist. Deshalb: Nur örtliche Ziele sind erlaubt, alles andere bricht ab,
 * bevor irgendetwas geschrieben wurde.
 */
function pruefeDatenbank(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    console.error("DATABASE_URL ist nicht gesetzt. Abbruch, bevor irgendetwas geschrieben wird.");
    process.exit(1);
  }
  if (!url.includes("localhost") && !url.includes("host.docker.internal") && !url.includes("127.0.0.1")) {
    console.error(
      "DATABASE_URL zeigt nicht auf eine örtliche Datenbank (localhost, 127.0.0.1 oder " +
        "host.docker.internal). Dieses Skript verändert und löscht Datensätze — Abbruch.",
    );
    process.exit(1);
  }
}

let geprueft = 0;
let fehlgeschlagen = 0;

function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) {
    console.log(`  ok    ${bezeichnung}`);
  } else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}

/**
 * Bringt die Einstellung in genau den Zustand zurück, in dem das Skript sie
 * vorgefunden hat.
 *
 * `upsert` statt `create`: Bricht der Ablauf VOR dem Löschen ab, steht die Zeile
 * noch, und ein `create` liefe in den Unique-Index — die Wiederherstellung
 * scheiterte ausgerechnet in dem Fall, für den es sie gibt.
 */
async function stelleWiederHer(schluessel: keyof typeof EINSTELLUNGEN, wert: string): Promise<void> {
  const d = EINSTELLUNGEN[schluessel];
  await prisma.einstellung.upsert({
    where: { schluessel },
    update: { wert },
    create: {
      schluessel,
      bezeichnung: d.bezeichnung,
      beschreibung: d.beschreibung,
      bereich: d.bereich,
      typ: d.typ,
      wert,
      minimum: d.minimum,
      maximum: d.maximum,
      einheit: d.einheit,
      sortierung: d.sortierung,
    },
  });
  console.log(`\n(Ausgangswert ${wert} wiederhergestellt.)`);
}

async function main() {
  pruefeDatenbank();

  const SCHLUESSEL = "AUTH_MAGIC_LINK_GUELTIG_MINUTEN" as const;
  const definition = EINSTELLUNGEN[SCHLUESSEL];
  const original =
    (await prisma.einstellung.findUnique({ where: { schluessel: SCHLUESSEL } }))?.wert ?? String(definition.standard);

  // Ab hier wird geschrieben. Alles, was folgt, steht im try — die
  // Wiederherstellung im finally. Vorher lief sie als letzte Anweisung des
  // Ablaufs: Brach eine Prüfung dazwischen ab (oder auch nur eine
  // Datenbankverbindung weg), war die Einstellung dauerhaft gelöscht, und die
  // Anwendung lief still auf dem Rückfallwert weiter.
  try {
    console.log("\n1. Lesen und Schreiben");
    pruefe("Standardwert ist gesetzt", (await zahl(SCHLUESSEL)) === definition.standard);

    const gesetzt = await setzeZahl(SCHLUESSEL, 45);
    pruefe("gültiger Wert lässt sich setzen", gesetzt.ok);
    pruefe("und wird gelesen", (await zahl(SCHLUESSEL)) === 45);

    console.log("\n2. Grenzen — serverseitig, nicht nur im Formular");
    const zuKlein = await setzeZahl(SCHLUESSEL, definition.minimum - 1);
    pruefe("unter dem Minimum wird abgelehnt", !zuKlein.ok);
    const zuGross = await setzeZahl(SCHLUESSEL, definition.maximum + 1);
    pruefe("über dem Maximum wird abgelehnt", !zuGross.ok);
    const keineGanzzahl = await setzeZahl(SCHLUESSEL, 12.5);
    pruefe("Kommazahl wird abgelehnt", !keineGanzzahl.ok);
    pruefe("nach den abgelehnten Versuchen steht der Wert unverändert", (await zahl(SCHLUESSEL)) === 45);

    console.log("\n3. Rückfallwert — eine kaputte Einstellung darf nichts lahmlegen");
    await prisma.einstellung.update({ where: { schluessel: SCHLUESSEL }, data: { wert: "voelliger unsinn" } });
    pruefe("unlesbarer Wert fällt auf den Standard zurück", (await zahl(SCHLUESSEL)) === definition.standard);

    await prisma.einstellung.update({ where: { schluessel: SCHLUESSEL }, data: { wert: "999999" } });
    pruefe("Wert außerhalb der Grenzen fällt auf den Standard zurück", (await zahl(SCHLUESSEL)) === definition.standard);

    await prisma.einstellung.delete({ where: { schluessel: SCHLUESSEL } });
    pruefe("fehlende Zeile fällt auf den Standard zurück", (await zahl(SCHLUESSEL)) === definition.standard);

    console.log("\n4. Gültigkeitstext in der E-Mail");
    pruefe('30 → "30 Minuten"', gueltigkeitAlsText(30) === "30 Minuten");
    pruefe('60 → "eine Stunde"', gueltigkeitAlsText(60) === "eine Stunde");
    pruefe('120 → "2 Stunden"', gueltigkeitAlsText(120) === "2 Stunden");
    pruefe('1440 → "einen Tag"', gueltigkeitAlsText(1440) === "einen Tag");
    pruefe('90 → "90 Minuten"', gueltigkeitAlsText(90) === "90 Minuten");

    // Die API (api/einstellungen) lässt nur Schlüssel durch, die diese Prüfung
    // besteht. Vorher stand dort `schluessel in EINSTELLUNGEN` — das ist auch
    // für Namen aus der Prototypkette wahr und endete in einem 500 statt 404.
    console.log("\n5. Nur bekannte Schlüssel — auch nicht über die Prototypkette");
    pruefe(
      "jeder definierte Schlüssel wird erkannt",
      Object.keys(EINSTELLUNGEN).every((s) => istEinstellungSchluessel(s)),
    );
    const prototypNamen = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
    pruefe(
      "Namen aus der Prototypkette gelten nicht als Einstellung",
      prototypNamen.every((s) => !istEinstellungSchluessel(s)),
      prototypNamen.filter((s) => istEinstellungSchluessel(s)),
    );
    pruefe(
      "unbekannter und leerer Schlüssel gelten nicht als Einstellung",
      !istEinstellungSchluessel("GIBT_ES_NICHT") && !istEinstellungSchluessel(""),
    );
  } finally {
    await stelleWiederHer(SCHLUESSEL, original);
  }

  // Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
  const ERWARTET = 19;
  const gelaufen = geprueft + 1;
  pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

  console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
  process.exit(fehlgeschlagen === 0 ? 0 : 1);
}

main()
  .catch((f) => {
    console.error(f);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

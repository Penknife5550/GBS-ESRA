/**
 * Gegenprobe für die Honorar-Abrechnung (DB-frei): der Zahlungsbeleg (Positionen,
 * Summe, IBAN in Vierergruppen) und die hinterlegte Grundlage (Recht).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import { baueAbrechnungBelegBloecke, type AbrechnungBelegDaten } from "../src/lib/honorar-abrechnung-beleg";
import { erzeugePdf } from "../src/lib/pdf";

let geprueft = 0;
let fehlgeschlagen = 0;
function pruefe(bezeichnung: string, bedingung: boolean, zusatz?: unknown) {
  geprueft++;
  if (bedingung) console.log(`  ok    ${bezeichnung}`);
  else {
    fehlgeschlagen++;
    console.log(`  FEHLT ${bezeichnung}`);
    if (zusatz !== undefined) console.log("        ", JSON.stringify(zusatz));
  }
}

const d = (iso: string) => new Date(iso);

console.log("\n1. Zahlungsbeleg (Positionen, Summe, IBAN)");
const daten: AbrechnungBelegDaten = {
  belegNr: "HONA-2026-07-30-ABCD1234",
  erzeugtAm: d("2026-07-30T10:00:00"),
  dozent: "Dozento, Dora",
  semester: "Herbstsemester 2026",
  statusText: "Freigegeben zur Auszahlung",
  kontoinhaber: "Dora Dozento",
  iban: "DE02120300000000202051",
  freigegebenVon: "Verwalta, Vera",
  freigegebenAm: d("2026-07-30T10:00:00"),
  ausgezahltAm: null,
  posten: [
    { datum: d("2026-08-25T19:00:00"), fach: "Bibelkunde Altes Testament", betrag: 60 },
    { datum: d("2026-09-01T19:00:00"), fach: "Kirchengeschichte", betrag: 70 },
  ],
  summe: 130,
  notiz: null,
};
const bloecke = baueAbrechnungBelegBloecke(daten);
const alsText = JSON.stringify(bloecke);
pruefe("der Beleg hat einen Titel-Block", bloecke.some((b) => b.art === "titel"));
pruefe("die Beleg-Nummer steht im Beleg", alsText.includes("HONA-2026-07-30-ABCD1234"));
pruefe("der Dozent steht im Beleg", alsText.includes("Dozento, Dora"));
pruefe("der Kontoinhaber steht im Beleg", alsText.includes("Dora Dozento"));
pruefe("die IBAN steht in Vierergruppen im Beleg", alsText.includes("DE02 1203 0000 0000 2020 51"));
pruefe("beide Positionen (Fach) stehen im Beleg", alsText.includes("Bibelkunde Altes Testament") && alsText.includes("Kirchengeschichte"));
pruefe("die unterschiedlichen Beträge je Abend stehen im Beleg", alsText.includes("60 €") && alsText.includes("70 €"));
pruefe("die Summe (130 €) steht im Beleg", alsText.includes("130 €"));
pruefe("der Freigeber steht im Beleg", alsText.includes("Verwalta, Vera"));
const pdf = erzeugePdf(bloecke);
pruefe("erzeugePdf liefert eine gültige PDF (Kopf %PDF)", pdf.subarray(0, 5).toString("latin1") === "%PDF-");
pruefe("die PDF ist nicht leer", pdf.length > 500);

console.log("\n2. Das Recht HONORAR_ABRECHNEN ist geseedet und den richtigen Rollen zugeordnet");
let seed = "";
try {
  seed = readFileSync("prisma/seed.ts", "utf8");
} catch {
  seed = "";
}
function rechteVon(rolle: string): string {
  const treffer = seed.match(new RegExp(`code: "${rolle}"[\\s\\S]*?rechte: \\[([^\\]]*)\\]`));
  return treffer ? treffer[1] : "";
}
pruefe("seed.ts ist lesbar", seed.length > 0);
pruefe(
  "HONORAR_ABRECHNEN ist als Recht im Bereich FINANZEN angelegt",
  /code: "HONORAR_ABRECHNEN"[\s\S]{0,140}bereich: "FINANZEN"/.test(seed),
);
pruefe("die Schulleitung darf abrechnen", rechteVon("SCHULLEITER").includes("HONORAR_ABRECHNEN"));
pruefe("die Verwaltung darf abrechnen", rechteVon("VERWALTUNG").includes("HONORAR_ABRECHNEN"));
pruefe(
  "der Teilnehmer darf NICHT abrechnen",
  rechteVon("TEILNEHMER").length > 0 && !rechteVon("TEILNEHMER").includes("HONORAR_ABRECHNEN"),
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 17;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

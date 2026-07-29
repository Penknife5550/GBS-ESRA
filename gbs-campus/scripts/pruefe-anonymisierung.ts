/**
 * Gegenprobe für die Anonymisierungs-Kernlogik (DSGVO Art. 17), DB-frei.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { ANONYM_PLATZHALTER, anonymEmail, anonymePersonFelder, scrubbeAntworten } from "../src/lib/anonymisierung";

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

console.log("\n1. Platzhalter-Adresse");
pruefe("die Adresse enthält die Person-Id (eindeutig)", anonymEmail("abc-123").includes("abc-123"));
pruefe("die Adresse endet auf @anonymisiert.invalid", anonymEmail("abc-123").endsWith("@anonymisiert.invalid"));
pruefe("verschiedene Personen bekommen verschiedene Adressen", anonymEmail("a") !== anonymEmail("b"));

console.log("\n2. Überschriebene Person-Felder");
const felder = anonymePersonFelder("abc-123");
pruefe("der Name wird überschrieben", felder.vorname === "Anonymisiert" && felder.nachname === "Person");
pruefe("die E-Mail wird zur Platzhalter-Adresse", felder.email === anonymEmail("abc-123"));
pruefe("IBAN und Kontoinhaber werden geleert", felder.ibanVerschluesselt === null && felder.kontoinhaber === null);
pruefe(
  "Kontakt- und Stammdaten werden geleert",
  felder.telefon === null &&
    felder.strasse === null &&
    felder.plz === null &&
    felder.ort === null &&
    felder.geburtsdatum === null &&
    felder.gemeinde === null &&
    felder.notiz === null,
);
pruefe("ein gesetztes Passwort wird entfernt", felder.passwortHash === null && felder.passwortGeaendertAm === null);
pruefe("der Status wird auf ANONYMISIERT gesetzt", felder.statusCode === "ANONYMISIERT");
pruefe("die Ehepartner-Kopplung wird gelöst", felder.ehepartnerId === null);

console.log("\n3. Anmelde-Antworten (Voll-Scrub)");
const antworten = { vorname: "Max", iban: "DE89370400440532013000", glaube_bekenntnis: "Seit meiner Jugend." };
const gescrubbt = scrubbeAntworten(antworten);
pruefe("jede Antwort wird zum Platzhalter", Object.values(gescrubbt).every((w) => w === ANONYM_PLATZHALTER));
pruefe(
  "keine ursprüngliche Angabe bleibt übrig",
  !JSON.stringify(gescrubbt).includes("Max") && !JSON.stringify(gescrubbt).includes("DE89"),
  gescrubbt,
);
pruefe(
  "die Schlüssel und ihre Anzahl bleiben erhalten",
  Object.keys(gescrubbt).length === 3 && "iban" in gescrubbt && "glaube_bekenntnis" in gescrubbt,
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 14;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

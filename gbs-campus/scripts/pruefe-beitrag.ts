/**
 * Gegenprobe für die Beitrags-Grundlagen (Release 0.1): der Ehepartner-Helfer
 * und die vier hinterlegten Beträge.
 *
 * Ohne Datenbank, ohne Test-Framework — läuft über `npm run pruefen` mit. Der
 * Einzug selbst kommt mit 0.3; hier wird geprüft, dass die Grundlage steht.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import { willEhepartnerErmaessigung, EHEPARTNER_FELD_CODE, ERMAESSIGUNG_EHEPARTNER } from "../src/lib/beitrag";

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

console.log("\n1. Ehepartner-Ermäßigung bei der Aufnahme");
pruefe("Boolean true löst die Ermäßigung aus", willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: true }) === true);
pruefe("Boolean false löst sie nicht aus", willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: false }) === false);
pruefe("fehlende Antwort löst sie nicht aus", willEhepartnerErmaessigung({}) === false);
pruefe("null löst sie nicht aus", willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: null }) === false);
pruefe('String "true" löst sie aus (Altbestand)', willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: "true" }) === true);
pruefe('String "ja" löst sie aus (Altbestand)', willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: "ja" }) === true);
pruefe('String "nein" löst sie nicht aus', willEhepartnerErmaessigung({ [EHEPARTNER_FELD_CODE]: "nein" }) === false);
pruefe("Ermäßigungscode ist EHEPARTNER (passend zum Seed)", ERMAESSIGUNG_EHEPARTNER === "EHEPARTNER");

console.log("\n2. Die vier Beträge sind als Einstellungen hinterlegt");
let quelltext = "";
try {
  quelltext = readFileSync("src/lib/einstellungen.ts", "utf8");
} catch {
  quelltext = "";
}
pruefe("einstellungen.ts ist lesbar", quelltext.length > 0);
pruefe(
  "genau vier Einstellungen im Bereich BEITRAG",
  (quelltext.match(/bereich: "BEITRAG"/g) ?? []).length === 4,
  (quelltext.match(/bereich: "BEITRAG"/g) ?? []).length,
);
pruefe("regulär monatlich = 20 €", /BEITRAG_REGULAER_MONATLICH[\s\S]{0,300}standard: 20\b/.test(quelltext));
pruefe("regulär halbjährlich = 120 €", /BEITRAG_REGULAER_HALBJAEHRLICH[\s\S]{0,300}standard: 120\b/.test(quelltext));
pruefe("mit Ehepartner monatlich = 30 €", /BEITRAG_EHEPARTNER_MONATLICH[\s\S]{0,300}standard: 30\b/.test(quelltext));
pruefe("mit Ehepartner halbjährlich = 180 €", /BEITRAG_EHEPARTNER_HALBJAEHRLICH[\s\S]{0,300}standard: 180\b/.test(quelltext));
pruefe("alle vier Beträge tragen die Einheit €", (quelltext.match(/einheit: "€"/g) ?? []).length >= 4);

const ERWARTET = 16;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

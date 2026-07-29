/**
 * Gegenprobe für die Stundenplan-Kernlogik (DB-frei): Anwesenheitsquote und der
 * Generator der Dienstagabende.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import { anwesenheitName, anwesenheitsquote, dienstagstermine, zaehltAlsTeilgenommen } from "../src/lib/stundenplan";

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

console.log("\n1. Anwesenheitsquote");
pruefe("4 von 5 (80 %) erfüllt die 80-%-Schwelle", anwesenheitsquote(["ANWESEND", "ANWESEND", "ANWESEND", "ANWESEND", "GEFEHLT"], 80).erfuellt === true);
pruefe("3 von 4 (75 %) erfüllt sie nicht", anwesenheitsquote(["ANWESEND", "ANWESEND", "ANWESEND", "GEFEHLT"], 80).erfuellt === false);
pruefe("nachgearbeitet zählt als teilgenommen", anwesenheitsquote(["NACHGEARBEITET", "NACHGEARBEITET"], 80).erfuellt === true);
pruefe("entschuldigt zählt NICHT als teilgenommen", anwesenheitsquote(["ANWESEND", "ENTSCHULDIGT"], 80).erfuellt === false);
pruefe("ohne Termine gilt die Quote als erfüllt", anwesenheitsquote([], 80).erfuellt === true);
{
  const q = anwesenheitsquote(["ANWESEND", "ANWESEND", "GEFEHLT"], 80);
  pruefe("Prozent wird gerundet (2 von 3 → 67 %)", q.prozent === 67, q);
  pruefe("teilgenommen und gesamt werden korrekt gezählt", q.teilgenommen === 2 && q.gesamt === 3, q);
}

console.log("\n2. Was als Teilnahme zählt");
pruefe("ANWESEND zählt", zaehltAlsTeilgenommen("ANWESEND") === true);
pruefe("NACHGEARBEITET zählt", zaehltAlsTeilgenommen("NACHGEARBEITET") === true);
pruefe("GEFEHLT zählt nicht", zaehltAlsTeilgenommen("GEFEHLT") === false);
pruefe("ENTSCHULDIGT zählt nicht", zaehltAlsTeilgenommen("ENTSCHULDIGT") === false);
pruefe("Klartext: GEFEHLT → gefehlt", anwesenheitName("GEFEHLT") === "gefehlt");
pruefe("Klartext: fehlender Status → —", anwesenheitName(null) === "—");

console.log("\n3. Dienstagabende eines Semesters");
// Semesterbeginn als Kalendertag (UTC-Mitternacht), wie @db.Date.
const start = new Date("2026-09-15");
const termine = dienstagstermine(start, 10);
pruefe("es entstehen genau 10 Termine", termine.length === 10, termine.length);
pruefe("jeder Termin ist ein Dienstag", termine.every((d) => d.getDay() === 2));
pruefe("jeder Termin liegt um 19:00 Uhr", termine.every((d) => d.getHours() === 19 && d.getMinutes() === 0));
pruefe("die Termine sind streng aufsteigend", termine.every((d, i) => i === 0 || d.getTime() > termine[i - 1].getTime()));
// Aufeinanderfolgend eine Kalenderwoche — in Stunden 168 ± 1 (Sommer-/Winterzeit).
pruefe(
  "aufeinanderfolgende Termine liegen eine Woche auseinander (zeitzonentolerant)",
  termine.every((d, i) => {
    if (i === 0) return true;
    const stunden = (d.getTime() - termine[i - 1].getTime()) / 3_600_000;
    return stunden >= 167 && stunden <= 169;
  }),
);
// Der erste Termin liegt am oder nach dem Semesterbeginn, höchstens knapp eine Woche später.
{
  const diffTage = (termine[0].getTime() - Date.UTC(2026, 8, 15)) / 86_400_000;
  pruefe("der erste Termin liegt am/nach dem Semesterbeginn (unter 7 Tagen)", diffTage >= 0 && diffTage < 7, diffTage);
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 20;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

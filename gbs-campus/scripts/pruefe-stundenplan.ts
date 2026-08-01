/**
 * Gegenprobe für die Stundenplan-Kernlogik (DB-frei): Anwesenheitsquote und der
 * Generator der Dienstagabende.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import {
  anwesenheitName,
  anwesenheitsquote,
  dienstagstermine,
  istDozentStatusErlaubt,
  offeneErfassung,
  zaehltAlsTeilgenommen,
} from "../src/lib/stundenplan";

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

console.log("\n4. Erlaubte Dozenten-Zustände (Anwesenheit an der Quelle)");
pruefe("ANWESEND ist für den Dozenten erlaubt", istDozentStatusErlaubt("ANWESEND") === true);
pruefe("GEFEHLT ist für den Dozenten erlaubt", istDozentStatusErlaubt("GEFEHLT") === true);
pruefe("NACHGEARBEITET ist für den Dozenten erlaubt", istDozentStatusErlaubt("NACHGEARBEITET") === true);
pruefe("ENTSCHULDIGT ist NICHT erlaubt (Schulentscheidung)", istDozentStatusErlaubt("ENTSCHULDIGT") === false);

console.log("\n5. Offene Erfassung (Dozenten-Übersicht: Offene Aufgaben)");
{
  const offen = offeneErfassung([
    {
      semesterBezeichnung: "Herbstsemester 2026",
      teilnehmer: [{ teilnahmeId: "t1" }, { teilnahmeId: "t2" }],
      termine: [
        { id: "a1", text: "Di 01", fach: "Bibelkunde", istVergangen: true }, // nur t1 erfasst → offen
        { id: "a2", text: "Di 02", fach: null, istVergangen: true }, // beide erfasst → nicht offen
        { id: "a3", text: "Di 03", fach: null, istVergangen: false }, // künftig → ignoriert
      ],
      anwesenheit: {
        a1: { t1: "ANWESEND" },
        a2: { t1: "ANWESEND", t2: "GEFEHLT" },
      },
    },
  ]);
  pruefe("genau ein Abend ist offen", offen.length === 1, offen);
  pruefe("offener Abend ist a1 mit 1 von 2 erfasst", offen[0]?.text === "Di 01" && offen[0]?.erfasst === 1 && offen[0]?.gesamt === 2, offen);
  pruefe("vollständig erfasster Abend zählt nicht", !offen.some((o) => o.text === "Di 02"), offen);
  pruefe("künftiger Abend zählt nicht", !offen.some((o) => o.text === "Di 03"), offen);
}
{
  // Ein Semester ohne aktive Teilnehmer darf nie als „offen" erscheinen (0/0).
  const ohne = offeneErfassung([
    { semesterBezeichnung: "X", teilnehmer: [], termine: [{ id: "a", text: "t", fach: null, istVergangen: true }], anwesenheit: {} },
  ]);
  pruefe("Semester ohne Teilnehmer erzeugt keine offenen Abende", ohne.length === 0, ohne);
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 29;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

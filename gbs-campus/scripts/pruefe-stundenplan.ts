/**
 * Gegenprobe für die Stundenplan-Kernlogik (DB-frei): Anwesenheitsquote und der
 * Generator der Dienstagabende.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 *
 * Zeitzone: Die Abende entstehen mit dem ÖRTLICHEN Konstruktor (19:00 vor Ort),
 * der Container läuft auf Europe/Berlin. Abschnitt 8 prüft deshalb feste
 * UTC-Zeitpunkte über die Umstellung auf Winter- und Sommerzeit — das Skript muss
 * mit TZ=Europe/Berlin laufen und wird sonst absichtlich rot. In UTC blieben die
 * übrigen Zeitprüfungen grün und bewiesen nichts.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  ANWESENHEIT_OPTIONEN,
  ANWESENHEIT_WERTE,
  anwesenheitName,
  anwesenheitsquote,
  dienstagstermine,
  istDozentStatusErlaubt,
  offeneErfassung,
  quoteErfuellt,
  quoteJeTeilnahme,
  quoteModellA,
  zaehltAlsTeilgenommen,
} from "../src/lib/stundenplan";

/** Liest eine Quelldatei (leer, wenn sie fehlt — die Prüfung wird dann rot). */
function lies(datei: string): string {
  try {
    return readFileSync(datei, "utf8");
  } catch {
    return "";
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
  // Die „Offenen Aufgaben" verlinken auf den Abend (#termin-<id>) — ohne die Id
  // wäre der Sprung „Jetzt erfassen" ein toter Anker.
  pruefe("der offene Abend trägt seine terminId (Anker „Jetzt erfassen“)", offen[0]?.terminId === "a1", offen);
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

console.log("\n6. Dozenten-Startseite lädt nur, was sie zeigt");
{
  const io = lies("src/lib/stundenplan-io.ts");
  const dozent = io.slice(io.indexOf("export async function ladeEigeneDozentTermine"));
  const abfrage = dozent.slice(dozent.indexOf("prisma.anwesenheit.findMany("), dozent.indexOf("select: { terminId: true, teilnahmeId: true"));
  // Ohne diese Grenze lädt jeder Aufruf die Anwesenheit ALLER Personen aller
  // vergangenen Abende des Dozenten — auch ausgeschiedener und abgemeldeter,
  // die die Oberfläche nie zeigt — und router.refresh holt alles erneut.
  pruefe(
    "die Anwesenheit der Dozenten-Abende ist auf zählende Teilnahmen aktiver Personen begrenzt",
    /teilnahme:\s*\{\s*\.\.\.TEILNAHME_ZAEHLT,\s*person:\s*PERSON_ZAEHLT_AKTIV\s*\}/.test(abfrage),
    abfrage.slice(0, 300),
  );
}

console.log("\n7. Eine Quote für alle Seiten (Modell A)");
{
  const abende = [
    { id: "v1", istVergangen: true }, // erfasst: anwesend
    { id: "v2", istVergangen: true }, // erfasst: gefehlt
    { id: "v3", istVergangen: true }, // noch nicht erfasst
    { id: "k1", istVergangen: false }, // künftig, im Voraus „entschuldigt"
  ];
  const matrix = { v1: { t: "ANWESEND" }, v2: { t: "GEFEHLT" }, k1: { t: "ENTSCHULDIGT" } };
  const q = quoteJeTeilnahme(abende, matrix, "t", 80);
  pruefe("der Nenner sind ALLE Abende des Semesters (auch künftige)", q.gesamt === 4, q);
  pruefe(
    "vergangene Abende zählen als teilgenommen/versäumt, ein künftiger Eintrag noch nicht",
    q.teilgenommen === 1 && q.versaeumt === 1 && q.offen === 2,
    q,
  );
  // quoteErfuellt ist die Kurzform von Modell A ERFUELLT — sie muss genau dann
  // „erfüllt" sagen, wenn Modell A ERFUELLT meldet, sonst zeigten zwei Seiten
  // für dieselbe Person Verschiedenes, sobald sie wieder jemand nutzt.
  let abweichung: unknown = null;
  for (const schwelle of [50, 75, 80, 100]) {
    for (let gesamt = 1; gesamt <= 20 && !abweichung; gesamt++) {
      for (let teil = 0; teil <= gesamt && !abweichung; teil++) {
        if (quoteErfuellt(teil, gesamt, schwelle) !== (quoteModellA(gesamt, teil, 0, schwelle).zustand === "ERFUELLT")) {
          abweichung = { schwelle, gesamt, teil };
        }
      }
    }
  }
  pruefe("quoteErfuellt ist deckungsgleich mit Modell A (ERFUELLT)", abweichung === null, abweichung);
  const seite = lies("src/app/verwaltung/stundenplan/page.tsx");
  pruefe(
    "die Stundenplanseite zeigt Modell A per QuoteChip (kein eigenes Rot auf Rot)",
    seite.includes("quoteJeTeilnahme(") && seite.includes("<QuoteChip") && !seite.includes("text-credo-rot"),
  );
  const client = lies("src/app/verwaltung/stundenplan/stundenplan-client.tsx");
  pruefe(
    "die Semesterwahl ist ein GET-Formular und navigiert nicht schon bei onChange",
    /<form method="get"[\s\S]{0,400}name="semester"/.test(client) && !/onChange=\{[^}]*router\.push/.test(client),
  );
}

console.log("\n8. Zeitzone Europe/Berlin — Abende über die Zeitumstellung");
{
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  pruefe("das Skript läuft in Europe/Berlin (TZ=Europe/Berlin)", zone === "Europe/Berlin", zone);
  // Winterzeit ab So., 25.10.2026: Der Abend bleibt 19:00 vor Ort, in UTC
  // wandert er von 17:00 auf 18:00. Eine Umsetzung mit festen 7×24 h läge nach
  // der Umstellung auf 18:00 Ortszeit — und bliebe in der 168±1-Prüfung grün.
  const herbst = dienstagstermine(new Date("2026-10-13"), 3).map((d) => d.toISOString());
  pruefe("Di. 20.10.2026 (Sommerzeit) liegt auf 17:00 UTC", herbst[1] === "2026-10-20T17:00:00.000Z", herbst);
  pruefe("Di. 27.10.2026 (Winterzeit) liegt auf 18:00 UTC", herbst[2] === "2026-10-27T18:00:00.000Z", herbst);
  // Sommerzeit ab So., 28.03.2027: umgekehrt von 18:00 auf 17:00 UTC.
  const fruehling = dienstagstermine(new Date("2027-03-23"), 2).map((d) => d.toISOString());
  pruefe(
    "Di. 23.03.2027 (Winterzeit) 18:00 UTC, Di. 30.03.2027 (Sommerzeit) 17:00 UTC",
    fruehling[0] === "2027-03-23T18:00:00.000Z" && fruehling[1] === "2027-03-30T17:00:00.000Z",
    fruehling,
  );
}

console.log("\n9. Anwesenheitsrouten: Fehlerbehandlung und eine Quelle für die Zustände");
{
  const dozentRoute = lies("src/app/api/dozent/anwesenheit/route.ts");
  pruefe(
    "Dozenten-Anwesenheit: unerwartete Fehler über mitFehlerbehandlung, kein toter default mit 500",
    /return mitFehlerbehandlung\("ANWESENHEIT", "Die Anwesenheit konnte nicht gespeichert werden\.", async \(\) => \{/.test(
      dozentRoute,
    ) &&
      /default:\s*return nieErreicht\(ergebnis\.fehler\);/.test(dozentRoute) &&
      !/default:\s*return fehler\(/.test(dozentRoute),
  );
  pruefe(
    "ANWESENHEIT_OPTIONEN: alle vier Werte, Klartext aus anwesenheitName",
    JSON.stringify(ANWESENHEIT_OPTIONEN.map((o) => o.wert)) === JSON.stringify(ANWESENHEIT_WERTE) &&
      ANWESENHEIT_WERTE.length === 4 &&
      ANWESENHEIT_OPTIONEN.every((o) => o.label === anwesenheitName(o.wert) && o.label !== "—"),
    ANWESENHEIT_OPTIONEN,
  );
  const clients = [
    "src/app/verwaltung/stundenplan/stundenplan-client.tsx",
    "src/app/dozent/stundenplan-dozent.tsx",
    "src/app/meine-daten/anwesenheit-abschnitt.tsx",
  ];
  pruefe(
    "keine eigene Liste der Anwesenheits-Zustände in Clients oder Route (Quelle: ANWESENHEIT_OPTIONEN / _WERTE)",
    clients.every((pfad) => /ANWESENHEIT_OPTIONEN/.test(lies(pfad)) && !/wert: "(ANWESEND|GEFEHLT|NACHGEARBEITET|ENTSCHULDIGT)"/.test(lies(pfad))) &&
      /z\.enum\(ANWESENHEIT_WERTE\)/.test(lies("src/app/api/stundenplan/anwesenheit/route.ts")),
  );
}

console.log("\n10. Ein Quotenmodell in der Oberfläche, Sprung „Jetzt erfassen“ wiederholbar");
{
  /** Alle .ts/.tsx unter einem Ordner (leer, wenn er fehlt — die Prüfung wird dann rot). */
  function dateien(ordner: string): string[] {
    try {
      return readdirSync(ordner).flatMap((name) => {
        const pfad = join(ordner, name);
        if (statSync(pfad).isDirectory()) return dateien(pfad);
        return /\.tsx?$/.test(name) ? [pfad] : [];
      });
    } catch {
      return [];
    }
  }
  const quelltext = dateien("src");
  const aufrufer = quelltext.filter((pfad) => !pfad.endsWith(join("lib", "stundenplan.ts")) && /\banwesenheitsquote\(/.test(lies(pfad)));
  pruefe(
    "kein Produktivcode rechnet die Quote über die erfassten Abende (anwesenheitsquote, @deprecated) — nur Modell A",
    quelltext.length > 50 && aufrufer.length === 0 && /@deprecated Nicht für Anzeigen\./.test(lies("src/lib/stundenplan.ts")),
    aufrufer,
  );
  const dozent = lies("src/app/dozent/stundenplan-dozent.tsx");
  pruefe(
    "der Sprung aus „Offene Aufgaben“ nimmt den Anker wieder aus der Adresse (derselbe Link klappt erneut auf)",
    /function oeffneAusAnker\(\)[\s\S]{0,900}?window\.history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.search\);/.test(
      dozent,
    ) && /window\.addEventListener\("hashchange", oeffneAusAnker\)/.test(dozent),
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 45;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

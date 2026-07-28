/**
 * Gegenprobe für die Semester- und Exportlogik.
 *
 * Kein Test-Framework, weil in Release 0.1 keines eingerichtet ist — dieses
 * Skript prüft dieselben Dinge und braucht keine Datenbank. Läuft über
 * `npm run pruefen` zusammen mit der Formularprüfung.
 *
 * ACHTUNG beim Erweitern (die Lehre aus dem Review vom 27.07.): Eine Prüfung
 * beweist erst dann etwas, wenn sie ROT wird, sobald man die geprüfte Regel
 * entfernt. Wer hier etwas ergänzt, kommentiert die Regel in
 * `src/lib/semester.ts` einmal aus und lässt das Skript laufen — bleibt es
 * grün, prüft die neue Zeile nicht das, was sie behauptet.
 *
 * Deshalb wird durchgängig auf die MELDUNG geprüft, nicht auf die Anzahl der
 * Meldungen: Ein Semester mit einem zweiten Fehler bestünde sonst jede Prüfung.
 */

import { readFileSync } from "fs";
import {
  alsHeutigerTag,
  alsTagesdatum,
  deutscherTag,
  EXPORT_SPALTEN,
  ExportZeile,
  pruefeSemester,
  SemesterDaten,
  semesterDaten,
  SemesterKandidat,
  semesterFuerAnmeldung,
  teilnahmeformName,
} from "../src/lib/semester";

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

/** Kurzform: Enthält die Mängelliste eine Meldung mit diesem Textbaustein? */
function meldetJemand(meldungen: { feld?: string; meldung: string }[], baustein: string): boolean {
  return meldungen.some((m) => m.meldung.includes(baustein));
}

const GUELTIG = {
  code: "2026-H",
  bezeichnung: "Herbstsemester 2026",
  start: "2026-09-15",
  ende: "2027-02-28",
  anmeldungVon: "2026-06-01",
  anmeldungBis: "2026-09-14",
};

console.log("\n1. Kalenderdatum");
pruefe("gültiges Datum wird angenommen", alsTagesdatum("2026-09-15")?.toISOString().startsWith("2026-09-15") === true);
pruefe("Leerzeichen am Rand stören nicht", alsTagesdatum(" 2026-09-15 ") !== null);
pruefe("31. Februar wird abgewiesen", alsTagesdatum("2026-02-31") === null);
pruefe("deutsche Schreibweise wird abgewiesen", alsTagesdatum("15.09.2026") === null);
pruefe("leerer Text wird abgewiesen", alsTagesdatum("") === null);
pruefe("Zahl statt Text wird abgewiesen", alsTagesdatum(20260915) === null);
pruefe("Datum liegt auf UTC-Mitternacht", alsTagesdatum("2026-09-15")?.getUTCHours() === 0);

console.log("\n2. Semesterprüfung");
pruefe("vollständiges Semester meldet nichts", pruefeSemester(GUELTIG).length === 0, pruefeSemester(GUELTIG));
pruefe(
  "Semester ohne Anmeldefenster meldet nichts",
  pruefeSemester({ ...GUELTIG, anmeldungVon: null, anmeldungBis: null }).length === 0,
);
pruefe(
  "Ende vor Beginn wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, start: "2027-01-01", ende: "2026-09-15" }), "nach seinem Beginn"),
);
pruefe(
  "Ende gleich Beginn wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, start: "2026-09-15", ende: "2026-09-15" }), "nach seinem Beginn"),
);
pruefe(
  "vertipptes Jahr (drei Jahre Laufzeit) wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, ende: "2029-02-28" }), "höchstens zwei Jahre"),
);
pruefe(
  "Kürzel mit Leerzeichen wird abgewiesen",
  meldetJemand(pruefeSemester({ ...GUELTIG, code: "2026 H" }), "Kürzel"),
);
pruefe("einzeichiges Kürzel ist zu kurz", meldetJemand(pruefeSemester({ ...GUELTIG, code: "H" }), "Kürzel"));
pruefe(
  "Kürzel mit 21 Zeichen wird abgewiesen",
  meldetJemand(pruefeSemester({ ...GUELTIG, code: "A".repeat(21) }), "Kürzel"),
);
pruefe(
  "Bezeichnung mit einem Zeichen wird abgewiesen",
  meldetJemand(pruefeSemester({ ...GUELTIG, bezeichnung: "H" }), "Bezeichnung"),
);
pruefe(
  "Anmeldeschluss vor Anmeldebeginn wird erkannt",
  meldetJemand(
    pruefeSemester({ ...GUELTIG, anmeldungVon: "2026-09-01", anmeldungBis: "2026-08-01" }),
    "nicht vor dem Anmeldebeginn",
  ),
);
pruefe(
  "Anmeldeschluss nach Semesterende wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, anmeldungBis: "2027-06-01" }), "nach dem Semesterende"),
);
pruefe(
  "unmögliches Datum im Anmeldefenster wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, anmeldungVon: "2026-02-31" }), "gültiges Datum für den Anmeldebeginn"),
);
pruefe(
  "unmöglicher Semesterbeginn wird erkannt",
  meldetJemand(pruefeSemester({ ...GUELTIG, start: "2026-13-01" }), "Semesterbeginn"),
);

console.log("\n3. Umformung in Datenbankwerte");
// `semesterDaten` ist die einzige Stelle, an der aus der Formulareingabe die
// Werte für `POST /api/semester` und `PUT /api/semester/[id]` entstehen. Vorher
// stand der Block in beiden Routen wortgleich — eine nur einmal nachgezogene
// Regel wäre lautlos halb wirksam gewesen. Geprüft wird deshalb jede Umformung
// einzeln: Wer `toUpperCase()` oder ein `trim()` entfernt, wird hier rot.
const daten: SemesterDaten = semesterDaten({
  ...GUELTIG,
  code: "  2026-h  ",
  bezeichnung: "  Herbstsemester 2026  ",
});
pruefe("Kürzel wird ohne Randleerzeichen und in Großbuchstaben übernommen", daten.code === "2026-H", daten.code);
pruefe(
  "die Bezeichnung verliert nur die Randleerzeichen",
  daten.bezeichnung === "Herbstsemester 2026",
  daten.bezeichnung,
);
pruefe(
  "der Semesterbeginn wird zum Kalendertag auf UTC-Mitternacht",
  daten.start.toISOString() === "2026-09-15T00:00:00.000Z",
  daten.start.toISOString(),
);
pruefe(
  "das Semesterende wird zum Kalendertag auf UTC-Mitternacht",
  daten.ende.toISOString() === "2027-02-28T00:00:00.000Z",
  daten.ende.toISOString(),
);
pruefe(
  "das Anmeldefenster wird mit umgeformt",
  daten.anmeldungVon?.toISOString() === "2026-06-01T00:00:00.000Z" &&
    daten.anmeldungBis?.toISOString() === "2026-09-14T00:00:00.000Z",
  [daten.anmeldungVon, daten.anmeldungBis],
);
// Ein nicht ausgefülltes Anmeldefenster kommt als leerer Text aus dem Formular,
// nicht als null. Würde daraus ein Datum geraten, stünde in der Datenbank ein
// Fenster, das niemand angegeben hat — und die Anmeldung liefe ins falsche
// Semester.
const ohneFenster = semesterDaten({ ...GUELTIG, anmeldungVon: "", anmeldungBis: null });
pruefe(
  "ein leeres Anmeldefenster wird zu null",
  ohneFenster.anmeldungVon === null && ohneFenster.anmeldungBis === null,
  [ohneFenster.anmeldungVon, ohneFenster.anmeldungBis],
);

console.log("\n4. Welches Semester gilt für eine eingehende Anmeldung?");

function semester(teil: Partial<SemesterKandidat> & { id: string }): SemesterKandidat {
  return {
    start: alsTagesdatum("2026-09-15")!,
    anmeldungVon: null,
    anmeldungBis: null,
    istAktuell: false,
    ...teil,
  };
}

// Ortszeit-Konstruktor: unabhängig von der Zeitzone des Rechners ist das der
// 20.07.2026, 10:00 Uhr vor Ort. Genau so kommt eine Anmeldung herein.
const imJuli = new Date(2026, 6, 20, 10, 0);

const laufendesFruehjahr = semester({ id: "fruehjahr", start: alsTagesdatum("2026-03-01")!, istAktuell: true });
const herbstMitFenster = semester({
  id: "herbst",
  anmeldungVon: alsTagesdatum("2026-06-01"),
  anmeldungBis: alsTagesdatum("2026-09-14"),
});

pruefe(
  "offenes Anmeldefenster sticht das laufende Semester",
  semesterFuerAnmeldung([laufendesFruehjahr, herbstMitFenster], imJuli) === "herbst",
);
pruefe(
  "ohne offenes Fenster gilt das laufende Semester",
  semesterFuerAnmeldung([laufendesFruehjahr], imJuli) === "fruehjahr",
);
pruefe(
  "Semester ganz ohne Fensterangabe gilt nicht als offen",
  semesterFuerAnmeldung([semester({ id: "ohne-fenster" })], imJuli) === null,
);
pruefe("ohne jedes Semester bleibt es leer", semesterFuerAnmeldung([], imJuli) === null);
pruefe(
  "vor dem Anmeldebeginn zählt das Fenster nicht",
  semesterFuerAnmeldung([herbstMitFenster], new Date(2026, 4, 31, 12, 0)) === null,
);
pruefe(
  "der erste Tag des Fensters zählt schon",
  semesterFuerAnmeldung([herbstMitFenster], new Date(2026, 5, 1, 0, 30)) === "herbst",
);
// Der häufigste Zeitzonenfehler: Der Anmeldeschluss ist ein Kalendertag, kein
// Zeitpunkt. Wer um 23:30 am Stichtag absendet, ist noch drin.
pruefe(
  "der letzte Tag des Fensters zählt ganz — auch um 23:30",
  semesterFuerAnmeldung([herbstMitFenster], new Date(2026, 8, 14, 23, 30)) === "herbst",
);
pruefe(
  "am Tag nach dem Anmeldeschluss ist das Fenster zu",
  semesterFuerAnmeldung([herbstMitFenster], new Date(2026, 8, 15, 0, 30)) === null,
);
pruefe(
  "offenes Fenster nur mit Anmeldeschluss (ohne Beginn) zählt",
  semesterFuerAnmeldung(
    [semester({ id: "nur-schluss", anmeldungBis: alsTagesdatum("2026-09-14") })],
    imJuli,
  ) === "nur-schluss",
);
pruefe(
  "bei zwei offenen Fenstern gewinnt das früher beginnende Semester",
  semesterFuerAnmeldung(
    [
      semester({ id: "spaeter", start: alsTagesdatum("2027-03-01")!, anmeldungVon: alsTagesdatum("2026-01-01") }),
      semester({ id: "frueher", start: alsTagesdatum("2026-09-15")!, anmeldungVon: alsTagesdatum("2026-01-01") }),
    ],
    imJuli,
  ) === "frueher",
);
pruefe(
  "der heutige Tag wird aus der ÖRTLICHEN Zeit gebildet",
  alsHeutigerTag(new Date(2026, 8, 15, 0, 30)).toISOString().startsWith("2026-09-15"),
);

console.log("\n5. Excel-Export — die Bankverbindung darf nicht hinein");
const beispiel: ExportZeile = {
  nachname: "Beispiel",
  vorname: "Petra",
  email: "petra@beispiel.de",
  telefon: "0571 123456",
  strasse: "Hauptstraße 1",
  plz: "32423",
  ort: "Minden",
  geburtsdatum: alsTagesdatum("1980-05-04"),
  gemeinde: "FeG Minden",
  teilnahmeform: "SCHUELER",
  status: "Aktiv",
  ermaessigung: "Ehepartner",
};

const titel = EXPORT_SPALTEN.map((s) => s.titel.toLowerCase()).join("|");
pruefe("keine Spalte heißt IBAN", !titel.includes("iban"));
pruefe("keine Spalte nennt die Bankverbindung", !titel.includes("bank"));
pruefe("keine Spalte nennt den Kontoinhaber", !titel.includes("konto"));

// Gegenprobe auf der Wertseite: Selbst wenn jemand ein Bankfeld unter
// harmlosem Namen ergänzt, darf keine IBAN in einer Zeile stehen.
const zeileMitIban = { ...beispiel, iban: "DE89370400440532013000" } as ExportZeile;
const werte = EXPORT_SPALTEN.map((s) => s.wert(zeileMitIban)).join("|");
// Nicht nur auf deutsche IBANs prüfen: Ein Teilnehmer aus Österreich oder der
// Schweiz hat AT61… oder CH93…, und `/DE\d{2}\d{4}/` hätte die anstandslos
// durchgelassen. Muster ist die allgemeine IBAN-Form (Länderkürzel, zwei
// Prüfziffern, dann mindestens zehn Stellen); das Trennzeichen „|" kann nicht
// Teil eines Treffers sein, ein Treffer liegt also immer in EINER Spalte.
pruefe("keine Spalte gibt eine IBAN aus", !/[A-Z]{2}\d{2}[A-Z0-9]{10,}/.test(werte), werte);

// Quelltextprüfung statt Datenbankabfrage: Die Liste wird von EINER Abfrage
// gefüllt. Holt die je wieder ein Bankfeld, steht die IBAN in der Datei, egal
// wie die Spalten heißen. Diese Prüfung wird rot, sobald jemand
// `ibanVerschluesselt` in die Auswahl zurückholt.
let quelltext = "";
try {
  quelltext = readFileSync("src/lib/teilnehmerliste.ts", "utf8");
} catch {
  quelltext = "";
}
pruefe("Quelltext der Listenabfrage ist lesbar", quelltext.length > 0);
pruefe("die Listenabfrage holt kein Bankfeld", quelltext.length > 0 && !/iban/i.test(quelltext));
// Die Wortsuche oben allein genügt nicht: `person: true` holt ALLE Spalten der
// Person, also auch `ibanVerschluesselt` — und das Wort „iban" käme im Quelltext
// trotzdem nicht vor. Deshalb zusätzlich: Die Abfrage muss ihre Felder
// ausdrücklich mit `select:` benennen und darf die Person nicht pauschal holen.
pruefe("die Listenabfrage benennt ihre Felder ausdrücklich (select:)", /select\s*:/.test(quelltext));
pruefe(
  "die Listenabfrage holt die Person nicht pauschal (person: true)",
  quelltext.length > 0 && !/person\s*:\s*true/.test(quelltext),
);

pruefe("Nachname steht in der ersten Spalte", EXPORT_SPALTEN[0].titel === "Nachname");
pruefe("Geburtsdatum erscheint in deutscher Schreibweise", werte.includes("04.05.1980"), werte);
pruefe("Teilnahmeform wird ausgeschrieben", werte.includes("Schüler"));

// Eine Zeile, in der wirklich jede freiwillige Angabe fehlt. Die alte Prüfung
// lief gegen `beispiel`, wo jedes Feld gesetzt war — sie konnte gar nicht rot
// werden. Das `String(...)` ist dabei nicht schmückend: `[null].join("|")` macht
// aus null von sich aus einen leeren Text, die Prüfung wäre also auch mit
// fehlendem `?? ""` grün geblieben.
const leereZeile: ExportZeile = {
  nachname: "Leer",
  vorname: "Lena",
  email: "lena@beispiel.de",
  telefon: null,
  strasse: null,
  plz: null,
  ort: null,
  geburtsdatum: null,
  gemeinde: null,
  teilnahmeform: null,
  status: "Interessent",
  ermaessigung: null,
};
const leereWerte = EXPORT_SPALTEN.map((s) => String(s.wert(leereZeile))).join("|");
pruefe("leere Angaben werden zu leerem Text, nicht zu „null“", !/null|undefined/.test(leereWerte), leereWerte);

console.log("\n6. Einzelheiten der Darstellung");
pruefe("Kalendertag ohne Zeitzonenversatz", deutscherTag(alsTagesdatum("2026-01-01")) === "01.01.2026");
pruefe("fehlendes Datum bleibt leer", deutscherTag(null) === "");
pruefe("HOERER wird zu Hörer", teilnahmeformName("HOERER") === "Hörer");
pruefe("fehlende Teilnahmeform bleibt leer", teilnahmeformName(null) === "");

// Soll-Anzahl: Nur so fällt auf, wenn eine Prüfung beim Umbauen herausfällt.
// Ein nicht gelaufener Test schlägt nicht fehl — er fehlt einfach, und die
// Schlusszeile meldet trotzdem „0 fehlgeschlagen". Beim Ergänzen mit anheben.
const ERWARTET = 54;
// `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
// Zeile — `pruefe` zählt erst im Rumpf hoch. Deshalb hier um eins vorgegriffen,
// damit sich die Prüfung selbst mitzählt.
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

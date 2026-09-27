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

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  abmeldegrundText,
  alsHeutigerTag,
  alsTagesdatum,
  deutscherTag,
  erinnerungsFeld,
  erledigteStufenBeiEinladung,
  EXPORT_SPALTEN,
  ExportZeile,
  faelligeErinnerungsstufe,
  KUERZEL_FEST,
  pruefeKuerzelUnveraendert,
  pruefeSemester,
  rueckmeldeFrist,
  rueckmeldeStand,
  rueckmeldungsWirkung,
  SemesterDaten,
  semesterDaten,
  semesterHatBegonnen,
  SemesterKandidat,
  semesterFuerAnmeldung,
  semesterZeitraum,
  teilnahmeformName,
  UeberleitungKandidat,
  waehleUeberzuleitende,
} from "../src/lib/semester";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "../src/lib/teilnahme-filter";
import { HEARTBEAT_ABSTAND_MS, heartbeatFaellig } from "../src/lib/aufraeumen-regel";
import {
  einladungNichtZugestellt,
  einladungZugestellt,
  hatNutzungsspuren,
  zuletztAbgemeldet,
  type VersandSpur,
} from "../src/lib/ueberleitung-regel";

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

/** Liest eine Quelldatei für die Quelltextprüfungen — leer, wenn sie fehlt (dann wird die Prüfung rot). */
function lies(datei: string): string {
  try {
    return readFileSync(datei, "utf8");
  } catch {
    return "";
  }
}

/** Ausschnitt ab `kopf` bis vor die nächste exportierte Deklaration (Rumpf einer Funktion). */
function rumpf(quelle: string, kopf: string): string {
  const a = quelle.indexOf(kopf);
  if (a < 0) return "";
  const b = quelle.indexOf("\nexport ", a + kopf.length);
  return quelle.slice(a, b < 0 ? undefined : b);
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

console.log("\n7. Semesterüberleitung — Erinnerungsstichtage (T-14/-7/-3)");
// Semesterbeginn 15.09.2026 (UTC-Kalendertag), Offsets 14/7/3 Tage davor.
const start = alsTagesdatum("2026-09-15")!;
// „Heute" kommt aus der ÖRTLICHEN Zeit — Testdaten deshalb mit dem lokalen
// Konstruktor, nie als ISO-String (sonst prüft man UTC statt Ortszeit).
pruefe("T-14 (01.09.) feuert Stufe 1", faelligeErinnerungsstufe(start, new Date(2026, 8, 1, 12, 0), [14, 7, 3]) === 1);
pruefe("T-7 (08.09.) feuert Stufe 2", faelligeErinnerungsstufe(start, new Date(2026, 8, 8, 12, 0), [14, 7, 3]) === 2);
pruefe("T-3 (12.09.) feuert Stufe 3", faelligeErinnerungsstufe(start, new Date(2026, 8, 12, 12, 0), [14, 7, 3]) === 3);
pruefe("der Tag vor T-14 feuert nicht", faelligeErinnerungsstufe(start, new Date(2026, 7, 31, 12, 0), [14, 7, 3]) === null);
pruefe("ein Tag zwischen den Stufen feuert nicht", faelligeErinnerungsstufe(start, new Date(2026, 8, 2, 12, 0), [14, 7, 3]) === null);
pruefe("der Semesterstart selbst feuert nicht", faelligeErinnerungsstufe(start, new Date(2026, 8, 15, 12, 0), [14, 7, 3]) === null);
// Der Stichtag ist ein Kalendertag: um 23:30 Ortszeit am 12.09. ist Stufe 3 noch fällig.
pruefe("T-3 feuert auch um 23:30 Ortszeit", faelligeErinnerungsstufe(start, new Date(2026, 8, 12, 23, 30), [14, 7, 3]) === 3);
pruefe("bei gleichen Offsets gewinnt die frühere Stufe", faelligeErinnerungsstufe(start, new Date(2026, 8, 1, 12, 0), [14, 14, 3]) === 1);
pruefe("Stufe 1 zeigt auf erinnertStufe1Am", erinnerungsFeld(1) === "erinnertStufe1Am");
pruefe("Stufe 2 zeigt auf erinnertStufe2Am", erinnerungsFeld(2) === "erinnertStufe2Am");
pruefe("Stufe 3 zeigt auf erinnertStufe3Am", erinnerungsFeld(3) === "erinnertStufe3Am");

console.log("\n8. Semesterüberleitung — Auswahl der zu Übernehmenden");
const kandidaten: UeberleitungKandidat[] = [
  { personId: "a", teilnahmeform: "SCHUELER", istAktiv: true },
  { personId: "b", teilnahmeform: "HOERER", istAktiv: true },
  { personId: "c", teilnahmeform: "SCHUELER", istAktiv: false },
];
const mitZielB = waehleUeberzuleitende(kandidaten, new Set(["b"]));
const alle = waehleUeberzuleitende(kandidaten, new Set<string>());
pruefe(
  "aktive Teilnehmer ohne Ziel-Teilnahme werden übernommen",
  mitZielB.length === 1 && mitZielB[0].personId === "a",
  mitZielB,
);
pruefe("die Teilnahmeform wird übernommen, nicht geraten", mitZielB[0]?.teilnahmeform === "SCHUELER");
pruefe(
  "wer im Zielsemester schon eine Teilnahme hat, wird übersprungen",
  alle.some((k) => k.personId === "b") && !mitZielB.some((k) => k.personId === "b"),
);
pruefe("inaktive Teilnehmer werden nicht übergeleitet", !alle.some((k) => k.personId === "c"));
pruefe("Hörer bleibt Hörer", alle.find((k) => k.personId === "b")?.teilnahmeform === "HOERER");
pruefe(
  "der Semesterzeitraum wird als Text gebildet",
  semesterZeitraum(alsTagesdatum("2026-09-15"), alsTagesdatum("2026-12-01")) === "15.09.2026 – 01.12.2026",
  semesterZeitraum(alsTagesdatum("2026-09-15"), alsTagesdatum("2026-12-01")),
);
pruefe("ohne Datumsangaben bleibt der Zeitraum leer", semesterZeitraum(null, null) === "");

console.log("\n9. Semesterpflege — Kursraster (Lehrjahr/Halbjahr) und festes Kürzel");
pruefe(
  "Lehrjahr 3 / Halbjahr 2 meldet nichts",
  pruefeSemester({ ...GUELTIG, lehrjahr: 3, halbjahr: 2 }).length === 0,
  pruefeSemester({ ...GUELTIG, lehrjahr: 3, halbjahr: 2 }),
);
pruefe("Lehrjahr 4 wird abgewiesen", meldetJemand(pruefeSemester({ ...GUELTIG, lehrjahr: 4, halbjahr: 1 }), "Lehrjahr ist 1, 2 oder 3"));
pruefe("Lehrjahr 0 wird abgewiesen", meldetJemand(pruefeSemester({ ...GUELTIG, lehrjahr: 0, halbjahr: 1 }), "Lehrjahr ist 1, 2 oder 3"));
pruefe("Halbjahr 3 wird abgewiesen", meldetJemand(pruefeSemester({ ...GUELTIG, lehrjahr: 1, halbjahr: 3 }), "Halbjahr ist 1"));
pruefe(
  "nur ein Lehrjahr ohne Halbjahr wird abgewiesen",
  meldetJemand(pruefeSemester({ ...GUELTIG, lehrjahr: 2, halbjahr: null }), "beide angeben"),
);
pruefe(
  "nur ein Halbjahr ohne Lehrjahr wird abgewiesen",
  meldetJemand(pruefeSemester({ ...GUELTIG, halbjahr: 1 }), "beide angeben"),
);
{
  const mitRaster = semesterDaten({ ...GUELTIG, lehrjahr: 3, halbjahr: 2 });
  pruefe("die Rasterverortung wird übernommen", mitRaster.lehrjahr === 3 && mitRaster.halbjahr === 2, mitRaster);
  const geleert = semesterDaten({ ...GUELTIG, lehrjahr: null, halbjahr: null });
  pruefe("null leert die Rasterverortung", geleert.lehrjahr === null && geleert.halbjahr === null, geleert);
  // Ein Aufrufer ohne die neuen Felder (älterer Client, curl) darf beim Ändern
  // die gespeicherte Verortung nicht löschen — der Schlüssel fehlt dann ganz.
  const ohne = semesterDaten(GUELTIG);
  pruefe("ohne Angabe bleibt die Rasterverortung unberührt", !("lehrjahr" in ohne) && !("halbjahr" in ohne), ohne);
}
pruefe("dasselbe Kürzel (andere Schreibweise) gilt als unverändert", pruefeKuerzelUnveraendert("2026-H", " 2026-h ") === null);
{
  const anders = pruefeKuerzelUnveraendert("2026-H", "2027-F");
  pruefe("ein anderes Kürzel wird feldgenau abgewiesen", anders?.feld === "code" && anders.meldung === KUERZEL_FEST, anders);
}

console.log("\n10. Semesterüberleitung — bin dabei / bin raus / keine Rückmeldung");
// Semesterbeginn 15.09.2026; „heute" aus der ÖRTLICHEN Zeit (lokaler Konstruktor).
pruefe("am Vortag um 23:30 hat das Semester nicht begonnen", semesterHatBegonnen(start, new Date(2026, 8, 14, 23, 30)) === false);
pruefe("am Starttag um 00:30 hat das Semester begonnen", semesterHatBegonnen(start, new Date(2026, 8, 15, 0, 30)) === true);
pruefe("Tage danach hat das Semester begonnen", semesterHatBegonnen(start, new Date(2026, 9, 1, 12, 0)) === true);
{
  // Jede Stufe, deren Stichtag heute oder früher liegt, erledigt die Einladung
  // mit — sonst folgte am selben Tag eine Erinnerung, deren frischer Link den
  // der Einladung entwertete (vorher nur für T-14 gelöst, nicht für T-7/T-3).
  const stufen = (jetzt: Date) => JSON.stringify(erledigteStufenBeiEinladung(start, jetzt, [14, 7, 3]));
  pruefe("Einladung 20 Tage vorher erledigt keine Stufe", stufen(new Date(2026, 7, 26, 9, 0)) === "[]", stufen(new Date(2026, 7, 26, 9, 0)));
  pruefe("Einladung am T-14-Stichtag erledigt Stufe 1", stufen(new Date(2026, 8, 1, 9, 0)) === "[1]", stufen(new Date(2026, 8, 1, 9, 0)));
  pruefe("Einladung zwischen T-14 und T-7 erledigt nur Stufe 1", stufen(new Date(2026, 8, 5, 9, 0)) === "[1]", stufen(new Date(2026, 8, 5, 9, 0)));
  pruefe("Einladung am T-7-Stichtag erledigt Stufe 1 und 2", stufen(new Date(2026, 8, 8, 9, 0)) === "[1,2]", stufen(new Date(2026, 8, 8, 9, 0)));
  pruefe("Einladung am Vortag von T-3 um 23:30 lässt Stufe 3 offen", stufen(new Date(2026, 8, 11, 23, 30)) === "[1,2]", stufen(new Date(2026, 8, 11, 23, 30)));
  pruefe("Einladung am T-3-Stichtag erledigt alle drei Stufen", stufen(new Date(2026, 8, 12, 9, 0)) === "[1,2,3]", stufen(new Date(2026, 8, 12, 9, 0)));
}
{
  // Die Frist in Mail und Seite ist der Vortag des Starts — genau der letzte
  // Tag, an dem `semesterHatBegonnen` die Antwort noch annimmt.
  const frist = rueckmeldeFrist(start);
  pruefe("die Antwortfrist ist der Vortag des Semesterstarts", deutscherTag(frist) === "14.09.2026", deutscherTag(frist));
  pruefe(
    "die Antwortfrist rechnet über den Monatswechsel",
    deutscherTag(rueckmeldeFrist(alsTagesdatum("2026-10-01")!)) === "30.09.2026" &&
      deutscherTag(rueckmeldeFrist(alsTagesdatum("2027-03-01")!)) === "28.02.2027",
  );
  const fristTag = (stunde: number, minute: number, plusTage = 0) =>
    new Date(frist.getUTCFullYear(), frist.getUTCMonth(), frist.getUTCDate() + plusTage, stunde, minute);
  pruefe("am Frist-Tag um 23:30 ist die Rückmeldung noch offen", semesterHatBegonnen(start, fristTag(23, 30)) === false);
  pruefe("am Tag nach der Frist um 00:30 ist sie geschlossen", semesterHatBegonnen(start, fristTag(0, 30, 1)) === true);
}
{
  const offen = { bestaetigtAm: null, abgemeldetAm: null, abmeldeGrund: null };
  const dabei = { bestaetigtAm: new Date(), abgemeldetAm: null, abmeldeGrund: null };
  const raus = { bestaetigtAm: null, abgemeldetAm: new Date(), abmeldeGrund: "BIN_RAUS" };
  const still = { bestaetigtAm: null, abgemeldetAm: new Date(), abmeldeGrund: "KEINE_RUECKMELDUNG" };
  pruefe("offen + dabei → setzen", rueckmeldungsWirkung(offen, "dabei") === "setzen");
  pruefe("offen + raus → setzen", rueckmeldungsWirkung(offen, "raus") === "setzen");
  pruefe("bestätigt + dabei → schon (idempotent)", rueckmeldungsWirkung(dabei, "dabei") === "schon");
  pruefe("bestätigt + raus → setzen (Antwort ändern)", rueckmeldungsWirkung(dabei, "raus") === "setzen");
  pruefe("abgesagt + dabei → setzen (Antwort ändern)", rueckmeldungsWirkung(raus, "dabei") === "setzen");
  pruefe("abgesagt + raus → schon (idempotent)", rueckmeldungsWirkung(raus, "raus") === "schon");
  pruefe("keine Rückmeldung + dabei → gesperrt (nur die Schulleitung nimmt wieder auf)", rueckmeldungsWirkung(still, "dabei") === "gesperrt");
  pruefe("keine Rückmeldung + raus → schon", rueckmeldungsWirkung(still, "raus") === "schon");
}
{
  const t = new Date();
  pruefe("eingeladen ohne Antwort → offen", rueckmeldeStand({ eingeladenAm: t, bestaetigtAm: null, abgemeldetAm: null }) === "offen");
  pruefe("eingeladen und bestätigt → bestätigt", rueckmeldeStand({ eingeladenAm: t, bestaetigtAm: t, abgemeldetAm: null }) === "bestaetigt");
  pruefe(
    "abgemeldet schlägt bestätigt",
    rueckmeldeStand({ eingeladenAm: t, bestaetigtAm: t, abgemeldetAm: t }) === "abgemeldet",
  );
  pruefe(
    "direkt aufgenommen (ohne Einladung) ist weder offen noch bestätigt",
    rueckmeldeStand({ eingeladenAm: null, bestaetigtAm: null, abgemeldetAm: null }) === "ohne_einladung",
  );
}
pruefe("Grund BIN_RAUS wird als Absage benannt", abmeldegrundText("BIN_RAUS").includes("Ich bin raus"));
pruefe("Grund KEINE_RUECKMELDUNG wird benannt", abmeldegrundText("KEINE_RUECKMELDUNG").includes("keine Rückmeldung"));
pruefe(
  "TEILNAHME_ZAEHLT filtert auf abgemeldetAm = null (und nur darauf)",
  JSON.stringify(TEILNAHME_ZAEHLT) === JSON.stringify({ abgemeldetAm: null }),
  TEILNAHME_ZAEHLT,
);

console.log("\n11. Zählende Teilnahme im Quelltext — jede Liste des Semesters filtert");
// Die Filter selbst brauchen eine Datenbank; geprüft wird deshalb, dass jede
// bekannte Teilnahme-Abfrage den gemeinsamen Filter einmischt. Gezählt werden
// nur Verwendungen im Code (`...TEILNAHME_ZAEHLT` bzw. `where: TEILNAHME_ZAEHLT`),
// weder die Import-Zeile noch Kommentare — fällt eine Stelle weg, wird die
// Zeile rot.
const FILTER_STELLEN: [string, number][] = [
  ["src/lib/teilnehmerliste.ts", 1], // Liste + Excel
  ["src/lib/stundenplan-io.ts", 4], // Erfassung, Selbstbestätigung, Dozent (Teilnehmer + Anwesenheit)
  ["src/lib/leistung-io.ts", 1], // Notenmatrix (Verwaltung + Dozent)
  ["src/lib/zeugnis-io.ts", 4], // Abschluss-Leistungen, Sammellauf, Vorschau, Übersicht
  ["src/lib/ueberleitung.ts", 1], // Quelle der Überleitung
  ["src/app/verwaltung/page.tsx", 1], // Kennzahl „Teilnehmer"
  ["src/app/verwaltung/personen/page.tsx", 3], // Filter Teilnahmeform + Spalten
  ["src/app/verwaltung/stundenplan/page.tsx", 1], // Erfassungszeilen
  ["src/app/verwaltung/semester/page.tsx", 1], // „N Personen zugeordnet"
];
for (const [datei, mindestens] of FILTER_STELLEN) {
  let anzahl = -1;
  try {
    anzahl = (readFileSync(datei, "utf8").match(/(?:\.\.\.|where:\s*)TEILNAHME_ZAEHLT\b/g) ?? []).length;
  } catch {
    anzahl = -1;
  }
  pruefe(`${datei} filtert mit TEILNAHME_ZAEHLT (mind. ${mindestens}×)`, anzahl >= mindestens, anzahl);
}
{
  // „Aktive Person" hat EINE Quelle. Vorher stand `status: { istAktiv: true }`
  // vierzehnmal im Code; eine Abfrage, die es vergisst oder anders schreibt,
  // zeigte Ausgeschiedene in Listen und Kennzahlen.
  pruefe(
    "PERSON_ZAEHLT_AKTIV filtert auf status.istAktiv = true (und nur darauf)",
    JSON.stringify(PERSON_ZAEHLT_AKTIV) === JSON.stringify({ status: { istAktiv: true } }),
    PERSON_ZAEHLT_AKTIV,
  );
  const alleDateien = (ordner: string): string[] => {
    try {
      return readdirSync(ordner).flatMap((eintrag) => {
        const pfad = join(ordner, eintrag);
        if (statSync(pfad).isDirectory()) return alleDateien(pfad);
        return /\.(ts|tsx)$/.test(pfad) ? [pfad] : [];
      });
    } catch {
      return [];
    }
  };
  const quellen = alleDateien("src").filter((pfad) => !pfad.endsWith("teilnahme-filter.ts"));
  const inline = quellen.filter((pfad) => /status:\s*\{\s*istAktiv:\s*true\s*\}/.test(readFileSync(pfad, "utf8")));
  const nutzer = quellen.filter((pfad) => /PERSON_ZAEHLT_AKTIV\b(?![^\n]*from ")/.test(readFileSync(pfad, "utf8")));
  pruefe(
    "kein Filter status: { istAktiv: true } außerhalb von teilnahme-filter.ts — alle nutzen PERSON_ZAEHLT_AKTIV",
    inline.length === 0 && nutzer.length >= 6,
    { inline, nutzer: nutzer.length },
  );
}
{
  let aufraeumen = "";
  let ueberleitung = "";
  try {
    aufraeumen = readFileSync("src/lib/aufraeumen.ts", "utf8");
    ueberleitung = readFileSync("src/lib/ueberleitung.ts", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  pruefe(
    "der Aufräumlauf schreibt weder eingeladenAm noch abgemeldetAm/abmeldeGrund",
    aufraeumen.length > 0 && !/(eingeladenAm|abgemeldetAm|abmeldeGrund)\s*:/.test(aufraeumen),
  );
  const anfang = ueberleitung.indexOf("export async function starteUeberleitung");
  const versand = ueberleitung.indexOf("export async function versendeEinladungen");
  pruefe(
    "starteUeberleitung setzt eingeladenAm und verschickt selbst nichts (Versand nach der Antwort)",
    anfang >= 0 &&
      versand > anfang &&
      ueberleitung.slice(anfang, versand).includes("eingeladenAm: jetzt") &&
      !ueberleitung.slice(anfang, versand).includes("sendeMail("),
  );
  const lauf = ueberleitung.slice(ueberleitung.indexOf("export async function fuehreErinnerungslauf"));
  // Genau zwei Schreibzugriffe je Teilnahme: Marke beanspruchen und — nur nach
  // Zustellung — Link tauschen. Ein dritter wäre die alte Rücknahme der Marke,
  // die bei SMTP-Ausfall stündlich ohne Obergrenze wiederholte.
  pruefe(
    "der Erinnerungslauf tauscht den Link erst NACH dem Versand und lässt die Marke bei Fehlschlag stehen",
    lauf.includes("sendeMail(") &&
      lauf.indexOf("sendeMail(") < lauf.indexOf("bestaetigungTokenHash: hashToken(token)") &&
      (lauf.match(/prisma\.teilnahme\.updateMany\(/g) ?? []).length === 2 &&
      /if \(!ok\) continue;/.test(lauf),
  );
  pruefe(
    "SEMESTER_ERINNERUNG_GELAUFEN steht nur im Audit, wenn etwas zugestellt wurde",
    /if \(gesendet > 0\) \{\s*await protokolliere\(\{\s*aktion: "SEMESTER_ERINNERUNG_GELAUFEN"/.test(lauf),
  );
  pruefe("Einladungen gehen höchstens zu dritt parallel raus", /const VERSAND_PARALLEL = 3;/.test(ueberleitung));
  const startRumpf = ueberleitung.slice(anfang, versand);
  pruefe(
    "starteUeberleitung lädt nur tatsächlich angelegte Teilnahmen ein (paralleler Doppelstart)",
    startRumpf.includes("createManyAndReturn(") &&
      !startRumpf.includes("teilnahme.createMany(") &&
      /anzulegen\.filter\(\(a\) => neuAngelegt\.has\(a\.person\.id\)\)/.test(startRumpf),
  );
  pruefe(
    "starteUeberleitung markiert jede schon erreichte Erinnerungsstufe (T-14, T-7, T-3)",
    startRumpf.includes("erledigteStufenBeiEinladung(") &&
      /erinnertStufe1Am: erledigtAm\(1\)/.test(startRumpf) &&
      /erinnertStufe2Am: erledigtAm\(2\)/.test(startRumpf) &&
      /erinnertStufe3Am: erledigtAm\(3\)/.test(startRumpf),
  );
}

// Die Verdrahtung der Fachentscheidung 2: Jede dieser Stellen könnte wegfallen,
// ohne dass eine reine Funktion rot würde — deshalb Quelltextprüfungen.
{
  const erstAbmeldenDannErinnern = (quelle: string) => {
    const abmelden = quelle.indexOf("schliesseRueckmeldungen(");
    const erinnern = quelle.indexOf("fuehreErinnerungslauf(");
    return abmelden >= 0 && erinnern > abmelden;
  };
  // (a) Ohne diesen Aufruf fiele ab Semesterstart niemand mehr heraus.
  pruefe("der Worker meldet ab, BEVOR er erinnert", erstAbmeldenDannErinnern(lies("scripts/worker.ts")));
  pruefe(
    "der Cron-Endpunkt meldet ab, BEVOR er erinnert",
    erstAbmeldenDannErinnern(lies("src/app/api/cron/erinnerungen/route.ts")),
  );
  const ueb = lies("src/lib/ueberleitung.ts");
  // (b) Kalendertag-Grenze und nur Eingeladene ohne Antwort.
  const schliessen = rumpf(ueb, "export async function schliesseRueckmeldungen");
  pruefe(
    "schliesseRueckmeldungen greift ab Semesterstart und nur bei offenen Einladungen",
    schliessen.includes("semesterHatBegonnen(") && (schliessen.match(/\.\.\.OFFENE_EINLADUNG/g) ?? []).length >= 2,
  );
  // (c) Erinnert werden nur Eingeladene ohne Antwort.
  pruefe(
    "der Erinnerungslauf filtert auf offene Einladungen",
    (rumpf(ueb, "export async function fuehreErinnerungslauf").match(/\.\.\.OFFENE_EINLADUNG/g) ?? []).length >= 2,
  );
  // (d) Die drei Sperren, die nicht über TEILNAHME_ZAEHLT laufen.
  pruefe(
    "die Selbstbestätigung sperrt eine abgemeldete Teilnahme",
    /if \(!teilnahme \|\| teilnahme\.abgemeldetAm\) return \{ fehler: "nicht_eingeschrieben" \}/.test(
      rumpf(lies("src/lib/stundenplan-io.ts"), "export async function bestaetigeEigeneAnwesenheit"),
    ),
  );
  pruefe(
    "ladePersonNoten liefert für eine abgemeldete Teilnahme nichts",
    /teilnahme\.abgemeldetAm\)\s*return null/.test(rumpf(lies("src/lib/leistung-io.ts"), "export async function ladePersonNoten")),
  );
  pruefe(
    "stelleZeugnisAus lehnt eine abgemeldete Teilnahme ab",
    /if \(teilnahme\.abgemeldetAm\) return \{ fehler: "abgemeldet" \}/.test(
      rumpf(lies("src/lib/zeugnis-io.ts"), "export async function stelleZeugnisAus"),
    ),
  );
  // (e) „dabei" hebt nur die EIGENE Absage auf, nie „keine Rückmeldung".
  const antwort = rumpf(ueb, "export async function beantworteEinladung");
  pruefe(
    "„Ich bin dabei“ hebt nur BIN_RAUS auf, nicht KEINE_RUECKMELDUNG",
    /OR: \[\{ bestaetigtAm: null, abgemeldetAm: null \}, \{ abmeldeGrund: ABMELDEGRUND\.BIN_RAUS \}\]/.test(antwort) &&
      !/abmeldeGrund: ABMELDEGRUND\.KEINE_RUECKMELDUNG/.test(antwort),
  );
  // (f) Die Route reicht die Antwort durch — sonst wäre jedes „raus" ein „dabei".
  pruefe(
    "die Rückmelde-Route reicht die Antwort an beantworteEinladung durch",
    lies("src/app/api/ueberleitung/bestaetigen/route.ts").includes(
      "beantworteEinladung(geprueft.data.token, geprueft.data.antwort)",
    ),
  );
  // Verschobener Semesterstart: Linkfrist in derselben Transaktion nachziehen,
  // Vorziehen auf heute bei offenen Einladungen abweisen.
  const semesterPut = lies("src/app/api/semester/[id]/route.ts");
  pruefe(
    "ein geänderter Semesterstart zieht die Linkfrist mit und schließt offene Rückmeldungen nicht still",
    /\$transaction\([\s\S]*ziehLinkfristNach\(tx,/.test(semesterPut) &&
      semesterPut.includes("zaehleOffeneEinladungen(") &&
      // Oben kurz, die Einzelheit nur am Feld — sonst stünde sie doppelt im Formular.
      /return fehler\("Bitte prüfen Sie den Semesterbeginn\.", 409, \[\{ feld: "start", meldung \}\]\)/.test(semesterPut),
  );
  // Startet die Überleitung am letzten Stichtag oder später, erledigt die
  // Einladung alle Stufen — eine nicht zugestellte wird nie wiederholt. Das
  // muss beim Start sichtbar sein.
  pruefe(
    "die Überleitungsseite warnt beim Start, wenn für das Ziel keine Erinnerung mehr folgt",
    /keineErinnerungMehr: erledigteStufenBeiEinladung\(s\.start, jetzt, \[o1, o2, o3\]\)\.length === 3/.test(
      lies("src/app/verwaltung/semesterueberleitung/page.tsx"),
    ) && /\{ziel\?\.keineErinnerungMehr && \(/.test(lies("src/app/verwaltung/semesterueberleitung/ueberleitung-starten.tsx")),
  );
}

console.log("\n12. Aufräumlauf und Worker — Lebenszeichen ohne Audit-Flut");
{
  const jetzt = new Date(2026, 8, 27, 12, 0);
  const vor = (ms: number) => new Date(jetzt.getTime() - ms);
  pruefe(
    "ein Lauf mit Löschungen wird immer protokolliert",
    heartbeatFaellig({ summe: 3, letzterLauf: vor(60_000), jetzt }) === true,
  );
  pruefe("der erste Lauf einer Herkunft wird protokolliert", heartbeatFaellig({ summe: 0, letzterLauf: null, jetzt }) === true);
  pruefe(
    "ein leerer Lauf knapp vor zwölf Stunden bleibt ohne Eintrag",
    heartbeatFaellig({ summe: 0, letzterLauf: vor(HEARTBEAT_ABSTAND_MS - 60_000), jetzt }) === false,
  );
  pruefe(
    "nach zwölf Stunden schreibt auch ein leerer Lauf das Lebenszeichen",
    HEARTBEAT_ABSTAND_MS === 12 * 60 * 60 * 1000 &&
      heartbeatFaellig({ summe: 0, letzterLauf: vor(HEARTBEAT_ABSTAND_MS), jetzt }) === true,
  );

  const aufraeumen = lies("src/lib/aufraeumen.ts");
  const worker = lies("scripts/worker.ts");
  const cron = lies("src/app/api/cron/erinnerungen/route.ts");
  pruefe(
    "der Aufräumlauf schreibt sein Lebenszeichen nur per heartbeatFaellig und je Herkunft",
    /if \(heartbeatFaellig\(/.test(aufraeumen) &&
      aufraeumen.indexOf("heartbeatFaellig(") < aufraeumen.indexOf('aktion: "AUFRAEUMEN_GELAUFEN",\n      objektTyp') &&
      /aktion: "AUFRAEUMEN_GELAUFEN", objektTyp: "System", objektId: herkunft/.test(aufraeumen) &&
      /objektId: herkunft,/.test(aufraeumen),
  );
  pruefe(
    "Worker und App räumen unter getrennter Herkunft auf (WORKER / APP)",
    worker.includes('raeumeAuf("WORKER")') && aufraeumen.includes('raeumeAuf("APP")'),
  );
  // laufeEinmal endet mit dem Lebenszeichen — nach allen Teilläufen, auch nach
  // einem gescheiterten (dafür gibt es den Audit-Eintrag darüber). Aber nur,
  // wenn mindestens einer gelungen ist: Erreicht der Worker die Datenbank gar
  // nicht, stünde der Healthcheck sonst dauerhaft auf grün.
  const laufAnfang = worker.indexOf("async function laufeEinmal");
  const lauf = laufAnfang < 0 ? "" : worker.slice(laufAnfang, worker.indexOf("\n}\n", laufAnfang) + 3);
  pruefe(
    "der Worker schreibt nach jedem Lauf mit mindestens einem gelungenen Teillauf sein Lebenszeichen (Docker-Healthcheck)",
    worker.includes('const LEBENSZEICHEN_DATEI = "/tmp/gbs-worker-lebenszeichen";') &&
      /if \(gelungen > 0\) \{\s*schreibeLebenszeichen\(\);\s*\} else \{[^}]*\}\s*\}\s*$/.test(lauf) &&
      (lauf.match(/gelungen \+= 1;/g) ?? []).length === 3 &&
      (lauf.match(/schreibeLebenszeichen\(\)/g) ?? []).length === 1,
    lauf.slice(-200),
  );
  pruefe(
    "Worker und Cron protokollieren gescheiterte Teilläufe — und nur dann",
    [worker, cron].every(
      (q) =>
        /if \(fehlgeschlagen\.length > 0\) \{\s*(?:\/\/[^\n]*\n\s*)*await protokolliere\(\{\s*aktion: "WORKER_LAUF_FEHLGESCHLAGEN"/.test(q) &&
        (q.match(/aktion: "WORKER_LAUF_FEHLGESCHLAGEN"/g) ?? []).length === 1,
    ),
  );
  // Bereit ist das Schema erst, wenn keine mitgelieferte Migration mehr fehlt —
  // und ohne Schema läuft kein Lauf („starte trotzdem" gibt es nicht mehr).
  const warten = worker.slice(worker.indexOf("async function warteAufSchema"), worker.indexOf("function schlafe"));
  pruefe(
    "der Worker wartet auf alle mitgelieferten Migrationen (nicht nur auf eine Tabelle)",
    worker.includes('readdirSync(join(process.cwd(), "prisma", "migrations")') &&
      /FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL/.test(worker) &&
      /const fehlen = erwartet \? await fehlendeMigrationen\(erwartet\) : \[\];\s*if \(fehlen\.length === 0\) return true;/.test(warten) &&
      /if \(!\(await warteAufSchema\(\)\)\) \{[\s\S]{0,600}process\.exit\(1\);/.test(worker) &&
      !worker.includes("starte trotzdem"),
  );
}

console.log("\n13. Semesterüberleitung — Rückmeldung durch Teilnahme, Nachversand, Zusage von Hand, zuletzt abgemeldet");
{
  // Worker-Ausfall: Wer zum Semesterstart schon am Unterricht teilnimmt, wird
  // nicht als „keine Rückmeldung" abgemeldet. Spur ist eine Anwesenheit, die als
  // teilgenommen zählt (anwesend/nachgearbeitet), oder eine Leistung.
  const mit = (...status: string[]) => ({ anwesenheiten: status.map((s) => ({ status: s })), leistungen: 0 });
  pruefe("eine Anwesenheit „anwesend“ ist eine Nutzungsspur", hatNutzungsspuren(mit("GEFEHLT", "ANWESEND")) === true);
  pruefe("„nachgearbeitet“ ist eine Nutzungsspur", hatNutzungsspuren(mit("NACHGEARBEITET")) === true);
  pruefe(
    "nur „gefehlt“ und „entschuldigt“ sind keine Nutzungsspur",
    hatNutzungsspuren(mit("GEFEHLT", "ENTSCHULDIGT", "GEFEHLT")) === false,
  );
  pruefe("eine Leistung ohne Anwesenheit ist eine Nutzungsspur", hatNutzungsspuren({ anwesenheiten: [], leistungen: 1 }) === true);
  pruefe("ohne Anwesenheit und Leistung keine Nutzungsspur", hatNutzungsspuren({ anwesenheiten: [], leistungen: 0 }) === false);
}
{
  // Nicht zugestellt = offene Einladung ohne GESENDET-Zeile (Einladung oder
  // Erinnerung) seit der Einladung. Zeitpunkte in UTC — es geht um Zeitpunkte,
  // nicht um Kalendertage.
  const eingeladen = new Date(Date.UTC(2026, 8, 1, 10, 0));
  const danach = new Date(eingeladen.getTime() + 60_000);
  const davor = new Date(eingeladen.getTime() - 60_000);
  const zeile = (vorlageCode: string | null, status: string, erstelltAm: Date): VersandSpur => ({ vorlageCode, status, erstelltAm });
  const E = "UEBERLEITUNG_EINLADUNG";
  pruefe(
    "eine gesendete Einladung nach der Einladung gilt als zugestellt",
    einladungZugestellt(eingeladen, [zeile(E, "GESENDET", danach)]) === true,
  );
  pruefe(
    "eine gesendete Erinnerung gilt ebenso als Zustellung",
    einladungZugestellt(eingeladen, [zeile("UEBERLEITUNG_ERINNERUNG", "GESENDET", danach)]) === true,
  );
  pruefe(
    "gesendet genau im Moment der Einladung zählt (erstelltAm >= eingeladenAm)",
    einladungZugestellt(eingeladen, [zeile(E, "GESENDET", eingeladen)]) === true,
  );
  pruefe(
    "nur FEHLER, WARTEND und BOUNCE → nicht zugestellt",
    einladungZugestellt(eingeladen, [zeile(E, "FEHLER", danach), zeile(E, "WARTEND", danach), zeile(E, "BOUNCE", danach)]) === false,
  );
  pruefe("ganz ohne Versandzeile → nicht zugestellt (Abbruch im Versand)", einladungZugestellt(eingeladen, []) === false);
  pruefe(
    "eine gesendete Mail VOR der Einladung (frühere Überleitung) zählt nicht",
    einladungZugestellt(eingeladen, [zeile(E, "GESENDET", davor)]) === false,
  );
  pruefe(
    "eine gesendete Mail mit anderer Vorlage (Anmeldelink, ohne Vorlage) zählt nicht",
    einladungZugestellt(eingeladen, [zeile("MAGIC_LINK", "GESENDET", danach), zeile(null, "GESENDET", danach)]) === false,
  );
  const offen = { eingeladenAm: eingeladen, bestaetigtAm: null, abgemeldetAm: null };
  pruefe(
    "eine offene Einladung mit gescheitertem Versand ist „nicht zugestellt“",
    einladungNichtZugestellt(offen, [zeile(E, "FEHLER", danach)]) === true,
  );
  pruefe(
    "bestätigt, abgemeldet oder ohne Einladung ist nie „nicht zugestellt“",
    einladungNichtZugestellt({ ...offen, bestaetigtAm: danach }, []) === false &&
      einladungNichtZugestellt({ ...offen, abgemeldetAm: danach }, []) === false &&
      einladungNichtZugestellt({ eingeladenAm: null, bestaetigtAm: null, abgemeldetAm: null }, []) === false,
  );
}
{
  // „Zuletzt abgemeldet": Die jüngste Teilnahme VOR dem Zielsemester ist
  // abgemeldet — dann lässt die Sammelübernahme die Person aus.
  const ziel = alsTagesdatum("2027-09-15")!;
  const t = (start: string, abgemeldet: boolean, grund: string | null = null) => ({
    semesterStart: alsTagesdatum(start)!,
    abgemeldetAm: abgemeldet ? alsTagesdatum("2027-01-10") : null,
    grund,
    semester: start,
  });
  const binRaus = zuletztAbgemeldet([t("2026-09-15", false), t("2027-02-15", true, "BIN_RAUS")], ziel);
  pruefe(
    "jüngste frühere Teilnahme mit „bin raus“ → zuletzt abgemeldet, mit Grund",
    binRaus?.grund === "BIN_RAUS" && binRaus.semester === "2027-02-15",
    binRaus,
  );
  pruefe(
    "jüngste frühere Teilnahme ohne Rückmeldung → zuletzt abgemeldet",
    zuletztAbgemeldet([t("2027-02-15", true, "KEINE_RUECKMELDUNG")], ziel)?.grund === "KEINE_RUECKMELDUNG",
  );
  pruefe(
    "früher abgesagt, danach wieder dabei → nicht zuletzt abgemeldet",
    zuletztAbgemeldet([t("2026-09-15", true, "BIN_RAUS"), t("2027-02-15", false)], ziel) === null,
  );
  // Die jüngste steht jeweils in der MITTE — weder „erste" noch „letzte" der
  // Liste träfe sie.
  pruefe(
    "die jüngste zählt nach Semesterbeginn, nicht nach Listenplatz",
    zuletztAbgemeldet([t("2026-09-15", true, "BIN_RAUS"), t("2027-02-15", false), t("2026-03-01", true, "BIN_RAUS")], ziel) ===
      null &&
      zuletztAbgemeldet([t("2026-09-15", false), t("2027-02-15", true, "BIN_RAUS"), t("2026-03-01", false)], ziel) !== null,
  );
  pruefe(
    "eine Absage für ein SPÄTERES Semester zählt nicht",
    zuletztAbgemeldet([t("2027-02-15", false), t("2028-02-15", true, "BIN_RAUS")], ziel) === null,
  );
  pruefe(
    "ein Semester mit demselben Beginn wie das Ziel zählt nicht als früher",
    zuletztAbgemeldet([t("2027-02-15", false), t("2027-09-15", true, "BIN_RAUS")], ziel) === null,
  );
  pruefe("ohne frühere Teilnahme ist niemand zuletzt abgemeldet", zuletztAbgemeldet([], ziel) === null);
  pruefe(
    "zwei Semester mit gleichem jüngstem Beginn: Zählt eines, ist die Person dabei",
    zuletztAbgemeldet([t("2027-02-15", true, "BIN_RAUS"), t("2027-02-15", false)], ziel) === null,
  );
}
{
  // Die Verdrahtung: Jede dieser Stellen könnte wegfallen, ohne dass eine reine
  // Funktion rot würde — deshalb Quelltextprüfungen.
  const ueb = lies("src/lib/ueberleitung.ts");
  const schliessen = rumpf(ueb, "export async function schliesseRueckmeldungen");
  pruefe(
    "der Lauf zum Semesterstart wertet Nutzungsspuren als Rückmeldung — bestätigt statt abgemeldet, eigener Audit-Eintrag",
    /if \(hatNutzungsspuren\(/.test(schliessen) &&
      schliessen.indexOf("hatNutzungsspuren(") < schliessen.indexOf("abmeldeGrund: ABMELDEGRUND.KEINE_RUECKMELDUNG") &&
      /where: \{ id: t\.id, \.\.\.OFFENE_EINLADUNG \},\s*data: \{ bestaetigtAm: jetzt \}/.test(schliessen) &&
      schliessen.includes('aktion: "TEILNAHME_RUECKMELDUNG_DURCH_TEILNAHME"') &&
      /durchTeilnahme: durchTeilnahme\.length/.test(schliessen),
  );
  // Worker und Cron geben den Bericht weiter (Log bzw. Antwort) — das bisherige
  // Feld muss bleiben, das neue kommt dazu.
  pruefe(
    "AbmeldeBericht behält „abgemeldet“ (Worker-Log, Cron-Antwort) und zählt „durchTeilnahme“ getrennt",
    /export type AbmeldeBericht = \{[^}]*abgemeldet: number;[^}]*durchTeilnahme: number;[^}]*\};/.test(ueb),
  );

  const zusage = rumpf(ueb, "export async function trageZusageEin");
  const zusageRoute = lies("src/app/api/semesterueberleitung/zusage/route.ts");
  pruefe(
    "die Zusage von Hand setzt bestaetigtAm nur auf eine offene Einladung (bedingtes updateMany), nur mit SEMESTER_VERWALTEN",
    /where: \{ id: teilnahmeId, \.\.\.OFFENE_EINLADUNG \},\s*data: \{ bestaetigtAm: jetzt \}/.test(zusage) &&
      zusage.includes('aktion: "TEILNAHME_ZUSAGE_EINGETRAGEN"') &&
      zusageRoute.includes("pruefeZugriff(RECHT.SEMESTER_VERWALTEN)") &&
      zusageRoute.includes("trageZusageEin("),
  );
  pruefe(
    "die Zusage von Hand verweist eine abgemeldete Teilnahme auf „Wieder aufnehmen“ und sperrt inaktive Personen",
    /if \(stand === "abgemeldet"\) return \{ status: "abgemeldet" \};/.test(zusage) &&
      /if \(!teilnahme\.person\.status\.istAktiv\)/.test(zusage) &&
      zusageRoute.includes("„Wieder aufnehmen“"),
  );

  const nachversand = rumpf(ueb, "export async function bereiteNachversandVor");
  const nachversandRoute = lies("src/app/api/semesterueberleitung/erneut-senden/route.ts");
  const versenden = rumpf(ueb, "export async function versendeEinladungen");
  pruefe(
    "„Erneut senden“: nur vor Semesterstart, frischer Link nur auf offene Einladungen, Versand nach der Antwort",
    /if \(semesterHatBegonnen\(ziel\.start, new Date\(\)\)\) return \{ status: "ziel_begonnen" \};/.test(nachversand) &&
      /where: \{ id: t\.id, \.\.\.OFFENE_EINLADUNG, bestaetigungTokenHash: t\.bestaetigungTokenHash \}/.test(nachversand) &&
      /bestaetigungLaeuftAb: ziel\.start/.test(nachversand) &&
      nachversandRoute.includes("pruefeZugriff(RECHT.SEMESTER_VERWALTEN)") &&
      /if \(ergebnis\.versand\) after\(ergebnis\.versand\);/.test(nachversandRoute),
  );
  pruefe(
    "ein laufender Versand (Start oder Nachversand) sperrt den Nachversand desselben Semesters",
    /if \(versandLaeuft\(ziel\.id\)\) return \{ status: "versand_laeuft" \};\s*versandBeginnt\(ziel\.id\);/.test(nachversand) &&
      /versandBeginnt\(ziel\.id\);\s*try \{/.test(versenden) &&
      /finally \{\s*versandEndet\(ziel\.id\);/.test(versenden),
  );
  pruefe(
    "die Zahl „nicht zugestellt“ und „Erneut senden“ kommen aus derselben Abfrage (ladeNichtZugestellte)",
    nachversand.includes("await ladeNichtZugestellte(ziel.id)") &&
      lies("src/app/verwaltung/semesterueberleitung/page.tsx").includes("await ladeNichtZugestellte(s.id)") &&
      /einladungNichtZugestellt\(t, /.test(rumpf(ueb, "export async function ladeNichtZugestellte")),
  );
  // Der Anker `schliesseRueckmeldungen(` stellt sicher, dass wirklich die beiden
  // Zeitgeber gelesen wurden — eine fehlende Datei soll rot werden, nicht grün.
  const zeitgeber = [lies("scripts/worker.ts"), lies("src/app/api/cron/erinnerungen/route.ts")];
  pruefe(
    "kein automatischer Nachversand: weder Worker noch Cron senden Einladungen erneut",
    ueb.includes("export async function bereiteNachversandVor") &&
      zeitgeber.every((q) => q.includes("schliesseRueckmeldungen(")) &&
      !zeitgeber.some((q) => q.includes("bereiteNachversandVor") || q.includes("versendeEinladungen")),
  );

  const liste = lies("src/lib/teilnehmerliste.ts");
  const uebernahme = lies("src/app/api/semester/[id]/teilnehmer/route.ts");
  const teilnehmerSeite = lies("src/app/verwaltung/teilnehmer/page.tsx");
  pruefe(
    "Zählung und Sammelübernahme teilen dieselbe Abfrage — angelegt wird nur, wer nicht zuletzt abgemeldet ist",
    /where: nochNichtImSemester\(semester\.id\)/.test(rumpf(liste, "export async function teileNochNichtZugeordnete")) &&
      /uebernehmbar: kandidaten\.filter\(\(k\) => k\.zuletztAbgemeldet === null\)/.test(liste) &&
      uebernahme.includes("await teileNochNichtZugeordnete(tx, semester)") &&
      /offen\.uebernehmbar\.flatMap\(/.test(uebernahme) &&
      !/offen\.zuletztAbgemeldet\.(?:flatMap|map|filter|forEach)\(|\.\.\.offen\.zuletztAbgemeldet/.test(uebernahme) &&
      teilnehmerSeite.includes("teileNochNichtZugeordnete(prisma, semester)"),
  );
  pruefe(
    "„zuletzt abgemeldet“ entscheidet die DB-freie Regel, gemessen am Beginn des Zielsemesters",
    /zuletztAbgemeldet\(\s*person\.teilnahmen\.map\(/.test(liste) &&
      /semesterStart: t\.semester\.start,/.test(liste) &&
      /\}\)\),\s*zielStart,\s*\);/.test(rumpf(liste, "function alsKandidat")),
  );
  pruefe(
    "die Einzelübernahme prüft nochNichtImSemester in ihrer Transaktion, verlangt die Teilnahmeform und protokolliert",
    /where: \{ id: personId, \.\.\.nochNichtImSemester\(semester\.id\) \}/.test(
      rumpf(liste, "export async function ladeUebernahmeKandidat"),
    ) &&
      uebernahme.includes("await ladeUebernahmeKandidat(tx, semester, personId)") &&
      /if \(!kandidat\.teilnahmeform\) return \{ status: "ohne_form" as const \};/.test(uebernahme) &&
      uebernahme.includes('aktion: "SEMESTER_TEILNEHMER_EINZELN_UEBERNOMMEN"'),
  );
  pruefe(
    "die Teilnehmerseite nennt die zuletzt Abgemeldeten getrennt, mit einem Knopf je Person",
    teilnehmerSeite.includes("Zuletzt abgemeldet (bin raus / keine Rückmeldung): ${zuletzt.length} — einzeln übernehmen") &&
      teilnehmerSeite.includes("<EinzelnUebernehmenKnopf"),
  );
  const ueberleitungsSeite = lies("src/app/verwaltung/semesterueberleitung/page.tsx");
  pruefe(
    "die Überleitungsseite hat „Zusage eintragen“ je offene Einladung, markiert nicht zugestellte und bietet „Erneut senden“",
    ueberleitungsSeite.includes("<ZusageKnopf") &&
      ueberleitungsSeite.includes("zustand?.nichtZugestellt.has(p.teilnahmeId)") &&
      ueberleitungsSeite.includes("<Nachversand") &&
      /\{`Einladung nicht zugestellt: \$\{anzahl\}`\}/.test(lies("src/app/verwaltung/semesterueberleitung/nachversand.tsx")),
  );
}

// Soll-Anzahl: Nur so fällt auf, wenn eine Prüfung beim Umbauen herausfällt.
// Ein nicht gelaufener Test schlägt nicht fehl — er fehlt einfach, und die
// Schlusszeile meldet trotzdem „0 fehlgeschlagen". Beim Ergänzen mit anheben.
const ERWARTET = 184;
// `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
// Zeile — `pruefe` zählt erst im Rumpf hoch. Deshalb hier um eins vorgegriffen,
// damit sich die Prüfung selbst mitzählt.
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

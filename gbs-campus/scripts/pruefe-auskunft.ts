/**
 * Gegenprobe für die Datenauskunft nach Art. 15 DSGVO.
 *
 * Ohne Datenbank, ohne Test-Framework — dieselbe Bauart wie die übrigen
 * `pruefe-*.ts`, läuft über `npm run pruefen` mit. Geprüft werden die reinen
 * Funktionen aus `src/lib/auskunft.ts` (Wert-Formatierung, Antwort-Zuordnung,
 * Baustein-Bau) und der PDF-Erzeuger aus `src/lib/pdf.ts`.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Regel auskommentieren, Skript
 * laufen lassen — bleibt es grün, prüft die neue Zeile nicht, was sie behauptet.
 */

import {
  formatiereWert,
  mappeAntworten,
  baueAuskunftBloecke,
  teilnahmeText,
  anwesenheitText,
  type AuskunftDaten,
  type FeldInfo,
} from "../src/lib/auskunft-inhalt";
import { erzeugePdf, type PdfBlock } from "../src/lib/pdf";

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

const feld = (code: string, label: string, typ: string, istArt9 = false): FeldInfo => ({
  code,
  label,
  typ: typ as FeldInfo["typ"],
  istArt9,
});

// ---------------------------------------------------------------------------
console.log("\n1. Wert-Formatierung");
pruefe("JA_NEIN true wird zu Ja", formatiereWert("JA_NEIN" as FeldInfo["typ"], true) === "Ja");
pruefe("JA_NEIN false wird zu Nein", formatiereWert("JA_NEIN" as FeldInfo["typ"], false) === "Nein");
pruefe('JA_NEIN "true" (String) wird zu Ja', formatiereWert("JA_NEIN" as FeldInfo["typ"], "true") === "Ja");
pruefe(
  "AUSWAHL_MEHRFACH wird zu einer Aufzählung",
  formatiereWert("AUSWAHL_MEHRFACH" as FeldInfo["typ"], ["A", "B"]) === "A, B",
);
pruefe("leerer Wert wird als (leer) ausgewiesen", formatiereWert("TEXT" as FeldInfo["typ"], "") === "(leer)");
pruefe("null wird als (leer) ausgewiesen", formatiereWert("TEXT" as FeldInfo["typ"], null) === "(leer)");
pruefe("Text wird unverändert übernommen", formatiereWert("TEXT" as FeldInfo["typ"], "Hallo") === "Hallo");
pruefe("Zahl wird zu Text", formatiereWert("ZAHL" as FeldInfo["typ"], 42) === "42");

// ---------------------------------------------------------------------------
console.log("\n2. Antwort-Zuordnung");
const felder: FeldInfo[] = [
  feld("vorname", "Vorname", "TEXT"),
  feld("hinweis1", "Bitte ausfüllen", "HINWEIS"),
  feld("glaube", "Ihr Glaubensweg", "MEHRZEILIG", true),
  feld("beruf", "Beruf", "TEXT"),
];
const antworten = { vorname: "Petra", glaube: "Bekehrung 2019", hinweis1: "sollte ignoriert werden", altfeld: "Wert aus alter Fassung" };
const zeilen = mappeAntworten(antworten, felder);

pruefe(
  "Antworten werden in Formular-Reihenfolge mit Label ausgegeben",
  zeilen[0]?.label === "Vorname" && zeilen[0]?.wert === "Petra",
  zeilen,
);
pruefe("Art-9-Feld wird als solches markiert", zeilen.some((z) => z.label === "Ihr Glaubensweg" && z.istArt9));
pruefe("Nicht-Art-9-Feld bleibt unmarkiert", zeilen.some((z) => z.label === "Vorname" && !z.istArt9));
pruefe("Hinweisfeld wird nicht als Antwort ausgegeben", !zeilen.some((z) => z.label === "Bitte ausfüllen"));
pruefe(
  "Feld ohne gespeicherte Antwort wird übersprungen",
  !zeilen.some((z) => z.label === "Beruf"), // 'beruf' steht nicht in antworten
);
pruefe(
  "Antwort zu einem unbekannten Code geht nicht verloren",
  zeilen.some((z) => z.label === "(altfeld)" && z.wert === "Wert aus alter Fassung"),
  zeilen,
);

// ---------------------------------------------------------------------------
console.log("\n3. Baustein-Bau");
const daten: AuskunftDaten = {
  erstelltAm: new Date("2026-07-29T08:00:00Z"),
  stammdaten: [
    { label: "Vorname", wert: "Petra" },
    { label: "IBAN", wert: "DE12 3456 7890 1234 5678 90" },
    { label: "Status", wert: "Angenommen" },
  ],
  rollen: ["Teilnehmer"],
  ehepartner: null,
  ermaessigung: null,
  internerVermerkVorhanden: true,
  anmeldungen: [
    {
      semester: "Herbstsemester 2026",
      status: "ANGENOMMEN",
      eingereichtAm: new Date("2026-07-01T09:00:00Z"),
      entschiedenAm: null,
      teilnahmeform: "SCHUELER",
      ablehnungsgrundVorhanden: false,
      antworten: [
        { label: "Motivation", wert: "Ich möchte tiefer einsteigen", istArt9: true },
        { label: "Beruf", wert: "Lehrer", istArt9: false },
      ],
    },
  ],
  einwilligungen: [
    { titel: "Datenschutz", version: 1, istArt9: false, erteilt: true, zeitpunkt: new Date("2026-07-01T09:00:00Z"), ipAdresse: "203.0.113.7" },
  ],
  statusWechsel: [{ von: null, nach: "Interessent", grund: null, automatisch: false, zeitpunkt: new Date("2026-07-01T09:00:00Z") }],
  teilnahmen: [
    {
      semester: "Herbstsemester 2026",
      teilnahmeform: "Schüler (mit Prüfung und Zeugnis)",
      eingeladenAm: null,
      bestaetigtAm: null,
      abgemeldetAm: null,
      abmeldeGrund: null,
    },
    {
      semester: "Frühlingssemester 2027",
      teilnahmeform: "Schüler (mit Prüfung und Zeugnis)",
      eingeladenAm: new Date("2027-01-10T10:00:00Z"),
      bestaetigtAm: null,
      abgemeldetAm: new Date("2027-01-20T10:00:00Z"),
      abmeldeGrund: "BIN_RAUS",
    },
  ],
  anwesenheiten: [
    { beginn: new Date("2026-09-15T17:00:00Z"), fach: "AT-Bibelkunde", status: "NACHGEARBEITET", selbstBestaetigt: true, vermerk: false },
    { beginn: new Date("2026-09-22T17:00:00Z"), fach: null, status: "GEFEHLT", selbstBestaetigt: false, vermerk: false },
  ],
  leistungen: [
    { semester: "Herbstsemester 2026", fach: "Bibelkunde", titel: "AT-Bibelkunde", ergebnis: "BESTANDEN", punkte: 12, note: "2" },
  ],
  zeugnisse: [
    {
      belegNr: "ZEU-2026-12-01-AAAA1111",
      typ: "SEMESTER",
      status: "ERSETZT",
      version: 1,
      semester: "Herbstsemester 2026",
      ausgestelltAm: new Date("2026-12-01T10:00:00Z"),
      dmsGesendetAm: null,
    },
    {
      belegNr: "ZEU-2026-12-05-BBBB2222",
      typ: "SEMESTER",
      status: "GUELTIG",
      version: 2,
      semester: "Herbstsemester 2026",
      ausgestelltAm: new Date("2026-12-05T10:00:00Z"),
      dmsGesendetAm: new Date("2026-12-05T10:05:00Z"),
    },
  ],
  unterrichtsabende: [{ beginn: new Date("2026-10-06T17:00:00Z"), semester: "Herbstsemester 2026", fach: "Dogmatik I" }],
  honorarAbrechnungen: [
    {
      semester: "Herbstsemester 2026",
      statusText: "Ausgezahlt",
      summe: 60,
      belegNr: "HON-2026-12-10-CCCC3333",
      erstelltAm: new Date("2026-12-10T10:00:00Z"),
      freigegebenAm: new Date("2026-12-11T10:00:00Z"),
      ausgezahltAm: new Date("2026-12-15T00:00:00Z"),
      dmsGesendetAm: new Date("2026-12-11T10:05:00Z"),
      vermerk: true,
      posten: [{ datum: new Date("2026-10-06T17:00:00Z"), fach: "Dogmatik I", betrag: 60 }],
    },
  ],
};
const bloecke = baueAuskunftBloecke(daten);
const kv = (label: string) => bloecke.find((b): b is Extract<PdfBlock, { art: "kv" }> => b.art === "kv" && b.label === label);

pruefe("Titel nennt Art. 15 DSGVO", bloecke.some((b) => b.art === "titel" && b.text.includes("Art. 15")));
pruefe(
  "IBAN steht im Klartext in der Auskunft (vollständige Kopie)",
  Boolean(kv("IBAN")?.wert.includes("DE12 3456")),
);
pruefe(
  "Art-9-Antwort trägt den Art-9-Hinweis am Label",
  bloecke.some((b) => b.art === "kv" && b.label.startsWith("Motivation") && b.label.includes("Art. 9")),
);
pruefe("gewöhnliche Antwort ist enthalten", Boolean(kv("Beruf")?.wert === "Lehrer"));
pruefe(
  "Anmeldungsstatus wird als freundliches Label ausgegeben (nicht roher Enum)",
  kv("Bearbeitungsstand")?.wert === "Angenommen",
  kv("Bearbeitungsstand")?.wert,
);
pruefe("Begleitangabe Beschwerderecht ist enthalten", Boolean(kv("Beschwerderecht")));
pruefe("Begleitangabe zu automatisierten Entscheidungen ist enthalten", Boolean(kv("Automatisierte Entscheidungen")));
pruefe(
  "alle zehn Abschnitts-Überschriften sind vorhanden",
  [
    "1. Stammdaten",
    "2. Anmeldungen",
    "3. Einwilligungen",
    "4. Statusverlauf",
    "5. Teilnahmen",
    "6. Anwesenheit",
    "7. Leistungen",
    "8. Zeugnisse",
    "9. Unterricht als Dozent",
    "10. Angaben nach Art. 15",
  ].every((t) => bloecke.some((b) => b.art === "h2" && b.text.startsWith(t))),
);
pruefe(
  "vorhandener interner Vermerk wird als 'gesondert herausgegeben' ausgewiesen",
  bloecke.some((b) => b.art === "klein" && b.text.includes("interner Freitext-Vermerk") && b.text.includes("gesondert")),
);

// ---------------------------------------------------------------------------
// Code-Review 4: Teilnahme-Rückmeldung, Anwesenheit (auch selbst bestätigt),
// Noten, Zeugnisse und Honorarabrechnungen gehören zur vollständigen Auskunft.
console.log("\n3a. Teilnahmen mit Rückmeldung und Abmeldung");
const kvWerte = (label: string) =>
  bloecke.filter((b): b is Extract<PdfBlock, { art: "kv" }> => b.art === "kv" && b.label === label).map((b) => b.wert);
const abgemeldet = kvWerte("Frühlingssemester 2027")[0] ?? "";
pruefe(
  "eine abgemeldete Teilnahme nennt Datum und Grund im Klartext (abmeldegrundText)",
  abgemeldet.includes("abgemeldet am 20.01.2027") && abgemeldet.includes("Ich bin raus"),
  abgemeldet,
);
pruefe("die Einladung zur Rückmeldung wird mit Datum ausgewiesen", abgemeldet.includes("eingeladen am 10.01.2027"), abgemeldet);
pruefe(
  "eine gewöhnliche Teilnahme erscheint nicht als abgemeldet",
  !(kvWerte("Herbstsemester 2026")[0] ?? "abgemeldet").includes("abgemeldet"),
  kvWerte("Herbstsemester 2026"),
);
pruefe(
  "„keine Rückmeldung bis Semesterstart“ wird als Grund benannt",
  teilnahmeText({ ...daten.teilnahmen[1], abmeldeGrund: "KEINE_RUECKMELDUNG" }).includes("keine Rückmeldung bis Semesterstart"),
);
pruefe(
  "zu abgemeldeten Teilnahmen steht der Hinweis, dass sie nicht zählen",
  bloecke.some((b) => b.art === "klein" && b.text.startsWith("Eine abgemeldete Teilnahme zählt")),
);

console.log("\n3b. Anwesenheit, Noten, Zeugnisse, Honorar");
const anwesenheitZeile = bloecke.find(
  (b): b is Extract<PdfBlock, { art: "kv" }> => b.art === "kv" && b.label.includes("15.09.2026"),
);
pruefe(
  "eine selbst bestätigte Anwesenheit steht mit Abend, Klartext-Status und „selbst bestätigt“ in der Auskunft",
  Boolean(anwesenheitZeile?.wert.includes("nachgearbeitet") && anwesenheitZeile.wert.includes("selbst bestätigt")),
  anwesenheitZeile,
);
pruefe(
  "eine von der Schule erfasste Anwesenheit wird als solche ausgewiesen",
  anwesenheitText(daten.anwesenheiten[1]).includes("von der Schule erfasst") &&
    !anwesenheitText(daten.anwesenheiten[1]).includes("selbst"),
  anwesenheitText(daten.anwesenheiten[1]),
);
pruefe(
  "ein Freitext-Vermerk der Schule zur Anwesenheit wird benannt (gesondert herausgegeben)",
  anwesenheitText({ ...daten.anwesenheiten[1], vermerk: true }).includes("gesondert"),
);
pruefe(
  "eine Bewertung steht mit Semester, Fach, Ergebnis, Punkten und Note in der Auskunft",
  kvWerte("Herbstsemester 2026 · Bibelkunde")[0] === "AT-Bibelkunde: bestanden · 12 Punkte · Note 2",
  kvWerte("Herbstsemester 2026 · Bibelkunde"),
);
const ersetzt = kvWerte("Beleg-Nr. ZEU-2026-12-01-AAAA1111")[0] ?? "";
const gueltig = kvWerte("Beleg-Nr. ZEU-2026-12-05-BBBB2222")[0] ?? "";
pruefe(
  "Zeugnisse stehen mit Beleg-Nr., Typ und Stand in der Auskunft — auch ersetzte Fassungen",
  ersetzt.startsWith("Zeugnis") && ersetzt.includes("ersetzt") && gueltig.includes("Fassung 2, gültig"),
  [ersetzt, gueltig],
);
pruefe("die Übermittlung eines Zeugnisses an das DMS wird mit Datum ausgewiesen", gueltig.includes("DMS") && !ersetzt.includes("DMS"));
pruefe(
  "ein Unterrichtsabend als Dozent steht mit Semester und Fach in der Auskunft",
  bloecke.some((b) => b.art === "kv" && b.label.includes("06.10.2026") && b.wert === "Herbstsemester 2026 · Dogmatik I"),
);
pruefe(
  "eine Honorarabrechnung steht mit Stand, Posten und Summe in der Auskunft",
  kvWerte("Stand")[0] === "Ausgezahlt" &&
    kvWerte("06.10.2026 · Dogmatik I")[0] === "60 €" &&
    kvWerte("Summe (1 Abend)")[0] === "60 €",
  [kvWerte("Stand"), kvWerte("06.10.2026 · Dogmatik I"), kvWerte("Summe (1 Abend)")],
);
pruefe("der Vermerk an einer Honorarabrechnung wird nur benannt", (kvWerte("Vermerk")[0] ?? "").includes("gesondert"));
pruefe(
  "die Übermittlung des Zahlungsbelegs (mit IBAN) an das DMS wird mit Datum ausgewiesen",
  kvWerte("An das Dokumentenarchiv (DMS) übermittelt am")[0] === "11.12.2026",
  kvWerte("An das Dokumentenarchiv (DMS) übermittelt am"),
);
pruefe(
  "der Zeugnis-Hinweis verweist nicht allein aufs Portal (Endzustände haben keinen Zugang mehr)",
  bloecke.some(
    (b) => b.art === "klein" && b.text.includes("auf Anfrage bei der Schulverwaltung") && b.text.includes("solange Ihr Portalzugang besteht"),
  ),
);

console.log("\n3c. Ablehnungsgrund einer Anmeldung");
const mitGrund = baueAuskunftBloecke({ ...daten, anmeldungen: [{ ...daten.anmeldungen[0], status: "ABGELEHNT", ablehnungsgrundVorhanden: true }] });
const grundZeilen = mitGrund.filter((b): b is Extract<PdfBlock, { art: "kv" }> => b.art === "kv" && b.label === "Ablehnungsgrund");
pruefe(
  "ein vorhandener Ablehnungsgrund wird benannt (gesondert herausgegeben), nicht abgedruckt",
  grundZeilen.length === 1 && grundZeilen[0].wert.includes("gesondert"),
  grundZeilen,
);
pruefe("ohne Ablehnungsgrund steht keine Zeile dazu in der Auskunft", !kv("Ablehnungsgrund"));

const leer = baueAuskunftBloecke({
  ...daten,
  teilnahmen: [],
  anwesenheiten: [],
  leistungen: [],
  zeugnisse: [],
  unterrichtsabende: [],
  honorarAbrechnungen: [],
});
const leerTexte = leer.filter((b) => b.art === "absatz").map((b) => (b as { text: string }).text);
pruefe(
  "leere Abschnitte sagen ausdrücklich „keine“ statt zu fehlen",
  [
    "Es ist keine Semesterteilnahme gespeichert.",
    "Es ist keine Anwesenheit gespeichert.",
    "Es ist keine Bewertung gespeichert.",
    "Es ist kein Zeugnis und keine Bescheinigung gespeichert.",
    "Sie sind keinem Unterrichtsabend als Dozent zugeordnet.",
    "Es ist keine Honorarabrechnung gespeichert.",
  ].every((t) => leerTexte.includes(t)),
  leerTexte,
);
pruefe(
  "ohne abgemeldete Teilnahme kein Hinweis auf abgemeldete Teilnahmen",
  !leer.some((b) => b.art === "klein" && b.text.startsWith("Eine abgemeldete Teilnahme")),
);

// ---------------------------------------------------------------------------
console.log("\n4. PDF-Erzeuger");
const pdf = erzeugePdf([
  { art: "titel", text: "Datenauskunft" },
  { art: "absatz", text: "Grüße mit Umlauten: ä ö ü Ä Ö Ü ß" },
  { art: "kv", label: "Beitrag", wert: "120 €" },
  { art: "absatz", text: "Eine Klammer (auf) und zu." },
]);
const alsText = pdf.toString("latin1");

pruefe("PDF beginnt mit %PDF-1.4", pdf.subarray(0, 8).toString("latin1") === "%PDF-1.4");
pruefe("PDF endet mit %%EOF", alsText.trimEnd().endsWith("%%EOF"));
pruefe("PDF enthält einen Katalog", alsText.includes("/Type /Catalog"));
pruefe("Umlaut ä ist als WinAnsi-Byte (0xE4) enthalten", pdf.includes(0xe4));
pruefe("Euro-Zeichen wird zu EUR ersetzt", alsText.includes("EUR") && !pdf.includes(0x80));
pruefe("PDF-Sonderzeichen ( wird escaped (\\()", alsText.includes("\\("));

const vieleZeilen: PdfBlock[] = Array.from({ length: 250 }, (_, i) => ({ art: "absatz", text: `Zeile Nummer ${i} mit etwas Text.` }));
const grossesPdf = erzeugePdf(vieleZeilen).toString("latin1");
const countTreffer = grossesPdf.match(/\/Count (\d+)/);
pruefe("langer Inhalt erzeugt mehrere Seiten", Boolean(countTreffer) && Number(countTreffer![1]) > 1, countTreffer?.[1]);

let emojiOk = true;
try {
  const e = erzeugePdf([{ art: "absatz", text: "Feier 🎉 und Text" }]);
  emojiOk = e.subarray(0, 5).toString("latin1") === "%PDF-";
} catch {
  emojiOk = false;
}
pruefe("nicht abbildbare Zeichen (Emoji) lassen den Erzeuger nicht abstürzen", emojiOk);

// ---------------------------------------------------------------------------
// Soll-Anzahl — beim Ergänzen einer Prüfung mit anheben. `geprueft` steht hier
// noch auf dem Stand VOR dieser Zeile, deshalb +1.
const ERWARTET = 52;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

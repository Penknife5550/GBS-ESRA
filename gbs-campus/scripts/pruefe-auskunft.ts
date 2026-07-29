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
  feld("glaube", "Dein Glaubensweg", "MEHRZEILIG", true),
  feld("beruf", "Beruf", "TEXT"),
];
const antworten = { vorname: "Petra", glaube: "Bekehrung 2019", hinweis1: "sollte ignoriert werden", altfeld: "Wert aus alter Fassung" };
const zeilen = mappeAntworten(antworten, felder);

pruefe(
  "Antworten werden in Formular-Reihenfolge mit Label ausgegeben",
  zeilen[0]?.label === "Vorname" && zeilen[0]?.wert === "Petra",
  zeilen,
);
pruefe("Art-9-Feld wird als solches markiert", zeilen.some((z) => z.label === "Dein Glaubensweg" && z.istArt9));
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
  teilnahmen: [{ semester: "Herbstsemester 2026", teilnahmeform: "Schüler (mit Prüfung und Zeugnis)", bestaetigtAm: null }],
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
  "alle sechs Abschnitts-Überschriften sind vorhanden",
  ["1. Stammdaten", "2. Anmeldungen", "3. Einwilligungen", "4. Statusverlauf", "5. Teilnahmen", "6. Angaben nach Art. 15"].every(
    (t) => bloecke.some((b) => b.art === "h2" && b.text.startsWith(t)),
  ),
);
pruefe(
  "vorhandener interner Vermerk wird als 'gesondert herausgegeben' ausgewiesen",
  bloecke.some((b) => b.art === "klein" && b.text.includes("interner Freitext-Vermerk") && b.text.includes("gesondert")),
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
const ERWARTET = 32;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

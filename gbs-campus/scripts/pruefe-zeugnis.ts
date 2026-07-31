/**
 * Gegenprobe für die Zeugnis-Kernlogik (DB-frei): Typ-Wahl (Hörer→Bescheinigung),
 * Titel, Beleg-Nummer, der eingefrorene Snapshot, die PDF-Bausteine
 * (`zeugnis-beleg.ts`) und der Seitenumbruch des PDF-Erzeugers.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import {
  baueZeugnisSnapshot,
  belegNrPraefix,
  istGewaehlterTyp,
  neueBelegNr,
  zeugnisTitel,
  zeugnistypFuer,
  type SnapshotEingabe,
} from "../src/lib/zeugnis";
import { baueSeriendruckBloecke, baueZeugnisBloecke } from "../src/lib/zeugnis-beleg";
import { erzeugePdf } from "../src/lib/pdf";

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

/** Baut einen Test-Snapshot; nur die abweichenden Felder überschreiben. */
function snap(overrides: Partial<SnapshotEingabe> = {}) {
  return baueZeugnisSnapshot({
    belegNr: "ZEU-2026-07-30-A1B2C3D4",
    typ: "SEMESTER",
    version: 1,
    ersetztBelegNr: null,
    personName: "Mustermann, Max",
    geburtsdatum: "01.01.2000",
    abschnitt: "Herbstsemester 2026",
    leistungen: [{ fach: "Bibelkunde", titel: "AT-Bibelkunde", ergebnis: "BESTANDEN", punkte: 87, note: "1,7" }],
    ausgestelltAm: "30.07.2026",
    ausgestelltVon: "Schulleitung",
    ort: "Minden",
    ...overrides,
  });
}

function seitenzahl(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page /g) || []).length;
}

console.log("\n1. Typ-Wahl (Hörer bekommen kein Zeugnis, nur eine Bescheinigung)");
pruefe("Hörer + Semester-Wahl → BESCHEINIGUNG", zeugnistypFuer("HOERER", "SEMESTER") === "BESCHEINIGUNG");
pruefe("Hörer + Abschluss-Wahl → BESCHEINIGUNG", zeugnistypFuer("HOERER", "ABSCHLUSS") === "BESCHEINIGUNG");
pruefe("Schüler + Semester-Wahl → SEMESTER", zeugnistypFuer("SCHUELER", "SEMESTER") === "SEMESTER");
pruefe("Schüler + Abschluss-Wahl → ABSCHLUSS", zeugnistypFuer("SCHUELER", "ABSCHLUSS") === "ABSCHLUSS");

console.log("\n2. Titel je Typ");
pruefe("SEMESTER → Zeugnis", zeugnisTitel("SEMESTER") === "Zeugnis");
pruefe("ABSCHLUSS → Abschlusszeugnis", zeugnisTitel("ABSCHLUSS") === "Abschlusszeugnis");
pruefe("BESCHEINIGUNG → Teilnahmebescheinigung", zeugnisTitel("BESCHEINIGUNG") === "Teilnahmebescheinigung");
pruefe("unbekannter Typ → Zeugnis (Default)", zeugnisTitel("XYZ") === "Zeugnis");

console.log("\n3. Beleg-Nummer");
pruefe("Bescheinigung → Präfix BESCH", belegNrPraefix("BESCHEINIGUNG") === "BESCH");
pruefe("Semester-Zeugnis → Präfix ZEU", belegNrPraefix("SEMESTER") === "ZEU");
pruefe("Abschlusszeugnis → Präfix ZEU", belegNrPraefix("ABSCHLUSS") === "ZEU");
{
  const nr = neueBelegNr("SEMESTER", new Date("2026-07-30T12:00:00Z"), "a1b2c3d4");
  pruefe("Format ZEU-JJJJ-MM-TT-XXXX mit Datum", nr === "ZEU-2026-07-30-A1B2C3D4", nr);
  pruefe("Zufallsteil wird großgeschrieben", nr.endsWith("A1B2C3D4"), nr);
}
{
  const nr = neueBelegNr("BESCHEINIGUNG", new Date("2026-07-30T12:00:00Z"), "00ff00ff");
  pruefe("Bescheinigung trägt BESCH-Präfix", nr.startsWith("BESCH-"), nr);
}

console.log("\n4. Gültige gewählte Typen (Serien-/Einzeldruck)");
pruefe("SEMESTER ist wählbar", istGewaehlterTyp("SEMESTER") === true);
pruefe("ABSCHLUSS ist wählbar", istGewaehlterTyp("ABSCHLUSS") === true);
pruefe("BESCHEINIGUNG ist NICHT direkt wählbar (folgt aus Hörer)", istGewaehlterTyp("BESCHEINIGUNG") === false);

console.log("\n5. Snapshot einfrieren");
{
  const s = snap({ version: 2, ersetztBelegNr: "ZEU-2026-07-29-DEADBEEF", leistungen: [
    { fach: "Bibelkunde", titel: "AT-Bibelkunde", ergebnis: "BESTANDEN", punkte: 87, note: "1,7" },
    { fach: "Dogmatik", titel: "Grundlagen", ergebnis: "TEILGENOMMEN", punkte: null, note: null },
  ] });
  pruefe("Snapshot-Version wird mitgeschrieben", s.snapshotVersion === 1, s.snapshotVersion);
  pruefe("Titel wird aus dem Typ abgeleitet", s.titel === "Zeugnis", s.titel);
  pruefe("Ergebnis-Klartext wird eingefroren (BESTANDEN → bestanden)", s.leistungen[0].ergebnisText === "bestanden", s.leistungen[0]);
  pruefe("Klartext auch für TEILGENOMMEN", s.leistungen[1].ergebnisText === "teilgenommen", s.leistungen[1]);
  pruefe("Punkte/Note bleiben erhalten", s.leistungen[0].punkte === 87 && s.leistungen[0].note === "1,7", s.leistungen[0]);
  pruefe("Storno-Vermerk (ersetztBelegNr) wird durchgereicht", s.ersetztBelegNr === "ZEU-2026-07-29-DEADBEEF", s.ersetztBelegNr);
  pruefe("Version wird übernommen", s.version === 2, s.version);
  pruefe("alle Leistungen sind im Snapshot", s.leistungen.length === 2, s.leistungen.length);
  pruefe("Person und Abschnitt werden übernommen", s.person.name === "Mustermann, Max" && s.abschnitt === "Herbstsemester 2026", s.person);
  // Regressionsschranke: die Gemeindezugehörigkeit (Art. 9 DSGVO) darf NICHT in den
  // Snapshot geraten — nur Name und Geburtsdatum sind erlaubt.
  pruefe("keine Gemeinde (Art. 9) im Snapshot", !("gemeinde" in s.person), Object.keys(s.person));
}

console.log("\n6. PDF-Bausteine (zeugnis-beleg.ts)");
{
  const bloecke = baueZeugnisBloecke(snap());
  pruefe("Semester-Zeugnis: Überschrift 'Leistungen'", bloecke.some((b) => b.art === "h2" && b.text === "Leistungen"));
  pruefe("kein Storno-Vermerk ohne ersetztBelegNr", bloecke.every((b) => !(b.art === "absatz" && b.text.includes("ersetzt den Beleg"))));
  const fachZeile = bloecke.find((b) => b.art === "kv" && b.label.startsWith("Bibelkunde"));
  pruefe(
    "Fach-Zeile setzt Ergebnis · Punkte · Note zusammen",
    fachZeile?.art === "kv" && fachZeile.wert === "bestanden · 87 Punkte · Note 1,7",
    fachZeile,
  );
}
{
  const bloecke = baueZeugnisBloecke(snap({ version: 2, ersetztBelegNr: "ZEU-2026-07-29-DEADBEEF" }));
  pruefe(
    "Storno-Vermerk erscheint bei ersetztBelegNr",
    bloecke.some((b) => b.art === "absatz" && b.text.includes("ersetzt den Beleg ZEU-2026-07-29-DEADBEEF")),
  );
}
{
  const bloecke = baueZeugnisBloecke(snap({ typ: "BESCHEINIGUNG", leistungen: [{ fach: "Bibelkunde", titel: "AT", ergebnis: "TEILGENOMMEN", punkte: null, note: null }] }));
  pruefe("Bescheinigung: Überschrift 'Besuchte Fächer'", bloecke.some((b) => b.art === "h2" && b.text === "Besuchte Fächer"));
}
{
  const serien = baueSeriendruckBloecke([snap(), snap({ typ: "BESCHEINIGUNG" })]);
  pruefe("Seriendruck: genau EIN Seitenumbruch zwischen zwei Zeugnissen", serien.filter((b) => b.art === "seitenumbruch").length === 1);
  pruefe("Seriendruck: kein führender Seitenumbruch (erster Block ist der Titel)", serien[0].art === "titel");
  pruefe("Seriendruck über 0 Zeugnisse ist leer", baueSeriendruckBloecke([]).length === 0);
}

console.log("\n7. PDF-Seitenumbruch (pdf.ts)");
pruefe("ein Umbruch zwischen zwei Absätzen erzeugt genau 2 Seiten", seitenzahl(erzeugePdf([{ art: "absatz", text: "A" }, { art: "seitenumbruch" }, { art: "absatz", text: "B" }])) === 2);
pruefe("ein führender Umbruch erzeugt KEINE Leerseite (1 Seite)", seitenzahl(erzeugePdf([{ art: "seitenumbruch" }, { art: "absatz", text: "A" }])) === 1);
pruefe("ohne Umbruch bleibt es bei 1 Seite", seitenzahl(erzeugePdf([{ art: "absatz", text: "A" }])) === 1);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 39;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

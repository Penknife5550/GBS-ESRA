/**
 * Gegenprobe für die Zeugnis-Kernlogik (DB-frei): Typ-Wahl (Hörer→Bescheinigung),
 * Titel, Beleg-Nummer, der eingefrorene Snapshot, die PDF-Bausteine
 * (`zeugnis-beleg.ts`, auch der Vermerk ersetzter Zeugnisse), der Seitenumbruch
 * des PDF-Erzeugers, die Regeln des Sammellaufs (`zeugnis-sammellauf.ts`:
 * Abschluss-Sperre, Rückfrage, Meldung) und — im Quelltext — Download-Sperre,
 * DMS-Versand nach der Antwort und der gesperrte Nachversand. Abschnitt 15: die
 * Hörer-Bescheinigung nennt nur besuchte Fächer (ohne besuchten Abend keine),
 * Abschnitt 16: der Storno ohne Ersatz (Grund, Vermerke, Sammellauf, Route).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen,
 * nie auf die Anzahl.
 */

import { readFileSync } from "fs";
import {
  baueZeugnisSnapshot,
  belegNrPraefix,
  bescheinigungsFaecher,
  istGewaehlterTyp,
  MELDUNG_OHNE_ANWESENHEIT,
  neueBelegNr,
  ohneBesuchtenAbend,
  pruefeStornoGrund,
  STORNO_GRUND_MAX_LAENGE,
  stornoRueckfrage,
  ungueltigMeldung,
  zeugnisDateiname,
  zeugnisStatusName,
  zeugnisTitel,
  zeugnistypFuer,
  type ErfassterAbend,
  type SnapshotEingabe,
} from "../src/lib/zeugnis";
import {
  baueSeriendruckBloecke,
  baueStornoVermerk,
  baueZeugnisBloecke,
  stornoVermerkText,
  ungueltigVermerkText,
} from "../src/lib/zeugnis-beleg";
import {
  ABSCHLUSS_SAMMELLAUF_GESPERRT,
  ABSCHLUSS_SAMMELLAUF_UNVERORTET,
  baueSammelVorschau,
  istLetztesRasterSemester,
  nichtsAuszustellenHinweis,
  RASTER_SEMESTER,
  sammellaufMeldung,
  sammellaufRueckfrage,
  sammellaufSperre,
  stornoSperreFuerPerson,
  zaehleOffeneFaecher,
  zeugnisSperreFuerPerson,
  type VorschauZeile,
} from "../src/lib/zeugnis-sammellauf";
import { erzeugePdf } from "../src/lib/pdf";
import { downloadFehler } from "../src/lib/api";

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
{
  // Zwischen 0 und 2 Uhr Berliner Zeit ist in UTC noch der Vortag — die Beleg-Nr
  // trägt den Berliner Tag, wie das Ausstellungsdatum im Snapshot (`datum()`).
  const sommer = neueBelegNr("SEMESTER", new Date("2026-07-29T22:30:00Z"), "a1b2c3d4");
  pruefe("Beleg-Nr trägt den Berliner Tag (Sommerzeit: 22:30 UTC → Folgetag)", sommer === "ZEU-2026-07-30-A1B2C3D4", sommer);
  const winter = neueBelegNr("SEMESTER", new Date("2026-12-31T23:30:00Z"), "a1b2c3d4");
  pruefe("Beleg-Nr trägt den Berliner Tag (Winterzeit: Silvester 23:30 UTC → Neujahr)", winter === "ZEU-2027-01-01-A1B2C3D4", winter);
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
  // Ein Abschnitt ohne erfasste Fächer (z. B. Semester ohne Unterrichtsabende mit
  // Fach): Hinweissatz statt einer leeren Tabelle.
  const leer = baueZeugnisBloecke(snap({ leistungen: [] }));
  const ab = leer.findIndex((b) => b.art === "h2" && b.text === "Leistungen");
  pruefe(
    "ohne Leistungen: Satz „keine Fächer erfasst“",
    leer.some((b) => b.art === "absatz" && b.text === "Für diesen Abschnitt sind keine Fächer erfasst."),
  );
  pruefe("ohne Leistungen: keine Fach-Zeile unter „Leistungen“", ab >= 0 && leer.slice(ab).every((b) => b.art !== "kv"), leer);
  pruefe(
    "mit Leistungen: kein Satz „keine Fächer erfasst“",
    baueZeugnisBloecke(snap()).every((b) => !(b.art === "absatz" && b.text.includes("keine Fächer erfasst"))),
  );
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

console.log("\n8. Sammellauf-Sperre (Abschlusszeugnisse gesammelt nur im letzten Rastersemester)");
pruefe("3. Lehrjahr, Frühling ist das letzte Rastersemester", istLetztesRasterSemester({ lehrjahr: 3, halbjahr: 2 }) === true);
pruefe("3. Lehrjahr, Herbst ist es NICHT", istLetztesRasterSemester({ lehrjahr: 3, halbjahr: 1 }) === false);
pruefe("2. Lehrjahr, Frühling ist es NICHT", istLetztesRasterSemester({ lehrjahr: 2, halbjahr: 2 }) === false);
pruefe("ein nicht verortetes Semester ist es NICHT", istLetztesRasterSemester({ lehrjahr: null, halbjahr: null }) === false);
{
  const sperre = sammellaufSperre("ABSCHLUSS", { lehrjahr: 1, halbjahr: 1 });
  pruefe("Abschluss-Sammellauf im 1. Lehrjahr ist gesperrt (mit Begründung)", sperre === ABSCHLUSS_SAMMELLAUF_GESPERRT, sperre);
  pruefe("die Begründung nennt das letzte Semester", (sperre ?? "").includes("letzten Semester der Ausbildung"), sperre);
}
pruefe("Abschluss-Sammellauf ohne Rasterbezug ist gesperrt", sammellaufSperre("ABSCHLUSS", { lehrjahr: null, halbjahr: null }) !== null);
pruefe("Abschluss-Sammellauf im letzten Rastersemester ist erlaubt", sammellaufSperre("ABSCHLUSS", { lehrjahr: 3, halbjahr: 2 }) === null);
pruefe("Semester-Sammellauf ist nie gesperrt (auch im 1. Lehrjahr)", sammellaufSperre("SEMESTER", { lehrjahr: 1, halbjahr: 1 }) === null);
{
  // Ein nicht verortetes Semester: Der allgemeine Text („nur im letzten
  // Semester“) führte in die Irre — der eigene nennt den Weg zur Zuordnung.
  const unverortet = sammellaufSperre("ABSCHLUSS", { lehrjahr: null, halbjahr: null });
  pruefe("nicht verortetes Semester: eigener Sperrtext", unverortet === ABSCHLUSS_SAMMELLAUF_UNVERORTET, unverortet);
  pruefe(
    "der Sperrtext nennt den Weg zur Zuordnung (Verwaltung → Semester, Lehrjahr und Halbjahr)",
    (unverortet ?? "").includes("Verwaltung → Semester") && (unverortet ?? "").includes("Lehrjahr und Halbjahr eintragen"),
    unverortet,
  );
  pruefe(
    "halb verortet (Halbjahr fehlt) gilt als nicht verortet",
    sammellaufSperre("ABSCHLUSS", { lehrjahr: 3, halbjahr: null }) === ABSCHLUSS_SAMMELLAUF_UNVERORTET,
  );
  pruefe(
    "verortet, aber nicht das letzte Semester: allgemeiner Sperrtext",
    sammellaufSperre("ABSCHLUSS", { lehrjahr: 2, halbjahr: 2 }) === ABSCHLUSS_SAMMELLAUF_GESPERRT,
  );
}

console.log("\n9. Rückfrage vor dem Sammellauf (Zahlen)");
pruefe("offene Fächer: erwartet minus bewertet", zaehleOffeneFaecher(["a", "b", "c"], ["b"]) === 2);
pruefe("offene Fächer: doppelte Kurseinheit zählt einmal", zaehleOffeneFaecher(["a", "a", "b"], []) === 2);
pruefe("offene Fächer: fremde Bewertungen ziehen nichts ab", zaehleOffeneFaecher(["a"], ["a", "x"]) === 0);
{
  const v = baueSammelVorschau([
    { typ: "SEMESTER", ausgestellt: false, storniert: false, besuchteFaecher: 0, offeneFaecher: 2, bewertet: 3, schuelerSemester: 1 },
    // Semester ohne Unterrichtsabende mit Fach: nichts offen, aber auch nichts bewertet.
    { typ: "SEMESTER", ausgestellt: false, storniert: false, besuchteFaecher: 0, offeneFaecher: 0, bewertet: 0, schuelerSemester: 1 },
    { typ: "SEMESTER", ausgestellt: true, storniert: false, besuchteFaecher: 0, offeneFaecher: 3, bewertet: 0, schuelerSemester: 1 },
    { typ: "BESCHEINIGUNG", ausgestellt: false, storniert: false, besuchteFaecher: 2, offeneFaecher: 5, bewertet: 0, schuelerSemester: 0 },
  ]);
  pruefe("Vorschau: 2 neue Zeugnisse", v.zeugnisse === 2, v);
  pruefe("Vorschau: 1 neue Bescheinigung (Hörer)", v.bescheinigungen === 1, v);
  pruefe("Vorschau: 1 bereits vorhanden", v.vorhanden === 1, v);
  pruefe("Vorschau: nur Auszustellende mit offenen Fächern zählen (Hörer und Vorhandene nicht)", v.mitOffenenFaechern === 1, v);
  pruefe("Vorschau: ganz ohne Bewertung zählen nur Auszustellende (Hörer und Vorhandene nicht)", v.ohneBewertung === 1, v);
  pruefe("Vorschau: beim Semester-Zeugnis zählt die Semesterzahl nicht", v.wenigerSemesterAlsRaster === 0, v);

  const text = sammellaufRueckfrage(v, "SEMESTER", "Herbstsemester 2026");
  pruefe("Rückfrage nennt Anzahl und Art", text.includes("2 Semester-Zeugnisse und 1 Teilnahmebescheinigung (Hörer)"), text);
  pruefe("Rückfrage nennt das Semester", text.includes("für Herbstsemester 2026 ausstellen?"), text);
  pruefe("Rückfrage nennt die Teilnehmer mit unbewerteten Fächern", text.includes("1 Teilnehmer hat noch unbewertete Fächer"), text);
  pruefe("Rückfrage warnt: sofort für die Schüler sichtbar", text.includes("sofort für die Schüler sichtbar"), text);
  pruefe(
    "Rückfrage nennt die Teilnehmer ganz ohne Bewertung (leeres Zeugnis)",
    text.includes("1 Teilnehmer hat noch überhaupt keine Bewertung — sein Zeugnis enthält dann keine Fächer."),
    text,
  );
  const ohneLeere = sammellaufRueckfrage({ ...v, ohneBewertung: 0 }, "SEMESTER", "Herbstsemester 2026");
  pruefe("ohne leere Zeugnisse kein Hinweis darauf", !ohneLeere.includes("keine Bewertung"), ohneLeere);

  const abschluss = sammellaufRueckfrage({ ...v, bescheinigungen: 0 }, "ABSCHLUSS", "Frühlingssemester 2029");
  pruefe("Rückfrage beim Abschluss nennt Abschlusszeugnisse", abschluss.includes("2 Abschlusszeugnisse für Frühlingssemester 2029"), abschluss);
  const ohneOffene = sammellaufRueckfrage({ ...v, mitOffenenFaechern: 0 }, "SEMESTER", "Herbstsemester 2026");
  pruefe("ohne offene Fächer kein Hinweis auf unbewertete Fächer", !ohneOffene.includes("unbewertete"), ohneOffene);
}
{
  // Abschluss: Ein Quereinsteiger mit nur einem Schüler-Semester hat „0 unbewertete
  // Fächer“ — die Rückfrage muss ihn trotzdem nennen.
  const a = baueSammelVorschau([
    { typ: "ABSCHLUSS", ausgestellt: false, storniert: false, besuchteFaecher: 0, offeneFaecher: 0, bewertet: 8, schuelerSemester: 1 },
    { typ: "ABSCHLUSS", ausgestellt: false, storniert: false, besuchteFaecher: 0, offeneFaecher: 0, bewertet: 40, schuelerSemester: RASTER_SEMESTER },
    { typ: "ABSCHLUSS", ausgestellt: true, storniert: false, besuchteFaecher: 0, offeneFaecher: 0, bewertet: 3, schuelerSemester: 2 },
  ]);
  pruefe("das Raster hat 6 Semester (3 Lehrjahre zu je 2 Halbjahren)", RASTER_SEMESTER === 6, RASTER_SEMESTER);
  pruefe("Abschluss: weniger Semester als das Raster zählt nur bei Auszustellenden", a.wenigerSemesterAlsRaster === 1, a);
  const text = sammellaufRueckfrage(a, "ABSCHLUSS", "Frühlingssemester 2029");
  pruefe(
    "Rückfrage nennt Teilnehmer mit weniger Semestern als das Raster",
    text.includes("1 Teilnehmer war in weniger als 6 Semestern als Schüler eingeschrieben"),
    text,
  );
  const vollstaendig = sammellaufRueckfrage({ ...a, wenigerSemesterAlsRaster: 0 }, "ABSCHLUSS", "Frühlingssemester 2029");
  pruefe("ohne Quereinsteiger kein Hinweis auf fehlende Semester", !vollstaendig.includes("weniger als"), vollstaendig);
}

console.log("\n10. Meldung nach dem Sammellauf (Fehlschläge sind kein Erfolg)");
{
  const teil = sammellaufMeldung({ ausgestellt: 3, vorhanden: 0, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 2, gesamt: 5 });
  pruefe("teilweise fehlgeschlagen → Fehlermeldung", teil.art === "fehler", teil);
  pruefe("die Fehlermeldung nennt die Zahl der Fehlschläge", teil.text.startsWith("2 Zeugnisse konnten nicht ausgestellt werden"), teil);
  const alle = sammellaufMeldung({ ausgestellt: 0, vorhanden: 0, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 3, gesamt: 3 });
  pruefe("alle fehlgeschlagen → Fehler, NICHT „waren bereits ausgestellt“", alle.art === "fehler" && !alle.text.includes("waren bereits ausgestellt"), alle);
  const eins = sammellaufMeldung({ ausgestellt: 0, vorhanden: 0, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 1, gesamt: 1 });
  pruefe("ein Fehlschlag: Einzahl", eins.text.startsWith("1 Zeugnis konnte nicht"), eins);
  const vorhanden = sammellaufMeldung({ ausgestellt: 0, vorhanden: 4, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 0, gesamt: 4 });
  pruefe("alles vorhanden → „bereits ausgestellt“", vorhanden.art === "ok" && vorhanden.text === "Alle Zeugnisse waren bereits ausgestellt.", vorhanden);
  const gemischt = sammellaufMeldung({ ausgestellt: 3, vorhanden: 1, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 0, gesamt: 4 });
  pruefe("Erfolg nennt Ausgestellte und Vorhandene", gemischt.art === "ok" && gemischt.text === "3 Zeugnisse ausgestellt, 1 bereits vorhanden.", gemischt);
  const leer = sammellaufMeldung({ ausgestellt: 0, vorhanden: 0, storniert: 0, ohneAnwesenheit: 0, fehlgeschlagen: 0, gesamt: 0 });
  pruefe("ohne Teilnehmer → Hinweis statt „bereits ausgestellt“", leer.art === "fehler" && leer.text.includes("keine aktiven Teilnehmer"), leer);
}

console.log("\n11. Keine (Neu-)Ausstellung für Anonymisierte und Endzustände");
pruefe(
  "aktive Person: Ausstellung erlaubt",
  zeugnisSperreFuerPerson({ code: "AKTIV", bezeichnung: "Aktiv", istTerminal: false }) === null,
);
{
  const anonym = zeugnisSperreFuerPerson({ code: "ANONYMISIERT", bezeichnung: "Anonymisiert", istTerminal: true });
  pruefe("anonymisierte Person: gesperrt mit Begründung", anonym !== null && anonym.includes("anonymisiert"), anonym);
  // Auch wenn der Schalter in der Statustabelle einmal falsch stünde: am Code
  // ANONYMISIERT hängt die Sperre unabhängig von istTerminal.
  const anonymOhneSchalter = zeugnisSperreFuerPerson({ code: "ANONYMISIERT", bezeichnung: "Anonymisiert", istTerminal: false });
  pruefe("anonymisiert sperrt auch ohne istTerminal", anonymOhneSchalter !== null, anonymOhneSchalter);
  const verstorben = zeugnisSperreFuerPerson({ code: "VERSTORBEN", bezeichnung: "Verstorben", istTerminal: true });
  pruefe(
    "Endzustand (Verstorben): gesperrt, die Meldung nennt den Status",
    verstorben !== null && verstorben.includes("Endzustand") && verstorben.includes("Verstorben"),
    verstorben,
  );
}
pruefe(
  "Absolvent (kein Endzustand mehr): Ausstellung erlaubt — das Abschlusszeugnis muss möglich bleiben",
  zeugnisSperreFuerPerson({ code: "ABSOLVENT", bezeichnung: "Absolvent", istTerminal: false }) === null,
);

console.log("\n12. Ersetzte Zeugnisse: Kopfvermerk im Nachdruck, 410 für den Schüler");
{
  const s = snap();
  const vorher = JSON.stringify(s);
  const mit = baueZeugnisBloecke(s, { durchBelegNr: "ZEU-2026-08-01-CAFEBABE", am: "01.08.2026" });
  const ohne = baueZeugnisBloecke(s);
  const kopf = mit[0];
  pruefe("der Vermerk steht vor allem anderen", kopf.art === "h2" && kopf.text.startsWith("UNGÜLTIG"), kopf);
  pruefe(
    "der Vermerk nennt Nachfolger und Datum",
    kopf.art === "h2" && kopf.text === "UNGÜLTIG – ersetzt durch Beleg ZEU-2026-08-01-CAFEBABE am 01.08.2026.",
    kopf,
  );
  const hinweis = mit[1];
  pruefe(
    "der Hinweis unter dem Vermerk ist neutral (auch Bescheinigung, auch Kette Z1 → Z2 → Z3)",
    hinweis.art === "absatz" &&
      hinweis.text === "Dieses Dokument ist nicht mehr gültig. Maßgeblich ist allein die jeweils gültige Ausfertigung.",
    hinweis,
  );
  pruefe("dahinter folgt der unveränderte Druck des Snapshots", JSON.stringify(mit.slice(2)) === JSON.stringify(ohne));
  pruefe("der Snapshot selbst bleibt unverändert", JSON.stringify(s) === vorher);
  pruefe("ein gültiges Zeugnis trägt keinen Vermerk", ohne.every((b) => !("text" in b) || !b.text.includes("UNGÜLTIG")));
  const ohneNachfolger = ungueltigVermerkText({ durchBelegNr: null, am: null });
  pruefe(
    "ohne auffindbaren Nachfolger: trotzdem „UNGÜLTIG“, keine erfundene Beleg-Nr",
    ohneNachfolger.startsWith("UNGÜLTIG") && !ohneNachfolger.includes("Beleg"),
    ohneNachfolger,
  );
}
{
  let route = "";
  let io = "";
  try {
    route = readFileSync("src/app/api/zeugnisse/[id]/pdf/route.ts", "utf8");
    io = readFileSync("src/lib/zeugnis-io.ts", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  pruefe(
    "PDF-Route: ersetztes Zeugnis ohne NOTEN_VERWALTEN → 410, erst NACH der Zugriffsprüfung",
    /return downloadFehler\(request, "Keine Berechtigung\.", 403\);[\s\S]{0,200}?status === "GUELTIG"[\s\S]{0,120}?if \(!gueltig && !darfAlle\)[\s\S]{0,300}?\b410,?\s*\)/.test(route),
  );
  pruefe(
    "PDF-Route: gedruckt wird über erzeugeZeugnisPdf (mit Vermerk), nicht roh aus dem Snapshot",
    /erzeugeZeugnisPdf\(dokument\)/.test(route) && !/AusSnapshot/.test(route),
  );
  pruefe(
    "Download lädt Status und Nachfolger (ersetztId)",
    /export async function ladeZeugnisFuerDownload[\s\S]{0,400}?status: true[\s\S]{0,600}?where: \{ ersetztId: z\.id \}/.test(io),
  );
}

console.log("\n13. DMS-Archivkopie nach der Antwort, Nachversand gesperrt und mit Abbruch (Quelltext)");
{
  let io = "";
  let ausstellen = "";
  let nachsenden = "";
  let client = "";
  try {
    io = readFileSync("src/lib/zeugnis-io.ts", "utf8");
    ausstellen = readFileSync("src/app/api/zeugnisse/ausstellen/route.ts", "utf8");
    nachsenden = readFileSync("src/app/api/zeugnisse/dms-nachsenden/route.ts", "utf8");
    client = readFileSync("src/app/verwaltung/zeugnisse/zeugnis-client.tsx", "utf8");
  } catch {
    // leer lassen — die Prüfungen unten werden dann rot
  }
  /** Der Quelltext einer exportierten Funktion bis zum nächsten Export. */
  function funktion(name: string): string {
    const start = io.indexOf(`export async function ${name}(`);
    if (start < 0) return "";
    const ende = io.indexOf("\nexport ", start + 1);
    return io.slice(start, ende < 0 ? undefined : ende);
  }
  const einzel = funktion("stelleZeugnisAus");
  const sammel = funktion("stelleSemesterZeugnisseAus");
  const nachversand = funktion("sendeOffeneZeugnisseAnDms");
  pruefe(
    "die Ausstellung (einzeln und gesammelt) wartet nicht auf die DMS-Mail",
    einzel !== "" && sammel !== "" && !/archiviere\w*ImDms\(/.test(einzel) && !/archiviere\w*ImDms\(/.test(sammel),
  );
  pruefe(
    "die Route schickt die Archivkopie nach der Antwort (after), einzeln und gesammelt",
    (ausstellen.match(/after\(\(\) => archiviereNeueImDms\(/g) ?? []).length === 2,
  );
  pruefe(
    "die Sammellauf-Antwort enthält nur die Zahlen, keine Snapshots",
    /const \{ neu, \.\.\.zahlen \} = ergebnis;/.test(ausstellen) &&
      /return erfolg\(zahlen\)/.test(ausstellen) &&
      !/return erfolg\(ergebnis\)/.test(ausstellen),
  );
  pruefe(
    "der Nachversand läuft unter der Sperre „zeugnis-dms-nachversand“",
    /const NACHVERSAND_SPERRE = "zeugnis-dms-nachversand";/.test(io) && /mitDmsSperre\(NACHVERSAND_SPERRE,/.test(nachversand),
  );
  pruefe(
    "ein zweiter gleichzeitiger Nachversand bekommt 409",
    /if \(lauf === "LAEUFT"\) return \{ fehler: "laeuft" \};/.test(nachversand) &&
      /ergebnis\.fehler === "laeuft"[\s\S]{0,200}?, 409\)/.test(nachsenden),
  );
  /** Der Quelltext einer (auch nicht exportierten) Funktion bis zur nächsten Deklaration auf oberster Ebene. */
  function helfer(name: string): string {
    const start = io.search(new RegExp(`\\n(export )?(async )?function ${name}\\(`));
    if (start < 0) return "";
    const rest = io.slice(start + 1);
    const ende = rest.search(/\n(\/\*\*|export |const |type |function |async function )/);
    return ende < 0 ? rest : rest.slice(0, ende);
  }
  const erstversand = helfer("archiviereNeueImDms");
  const senden = helfer("sendePaketeAnDms");
  const pakete = helfer("paketeJeAbschnitt");
  pruefe(
    "Versandlauf bricht nach dem ersten Fehlschlag ab (Erst- und Nachversand)",
    /stand\.fehlgeschlagen \+= teil\.length;\s*break;/.test(senden) &&
      /sendePaketeAnDms\(/.test(nachversand) &&
      /sendePaketeAnDms\(/.test(erstversand),
  );
  pruefe(
    "höchstens 4 Mails je Nachversand-Lauf",
    /const DMS_MAILS_JE_LAUF = 4;/.test(io) && /pakete\.slice\(0, DMS_MAILS_JE_LAUF\)/.test(nachversand),
  );
  pruefe(
    "Zeitbudget: ein weiteres Paket nur innerhalb von DMS_LAUF_BUDGET_MS (20 s)",
    /const DMS_LAUF_BUDGET_MS = 20_000;/.test(io) &&
      /if \(i > 0 && Date\.now\(\) - start > DMS_LAUF_BUDGET_MS\) break;/.test(senden),
  );
  pruefe(
    "Erstversand gruppiert wie der Nachversand je Abschnitt in Pakete zu DMS_JE_MAIL",
    /const schluessel = z\.snapshot\.abschnitt \?\? "";/.test(pakete) &&
      /gruppe\.slice\(i, i \+ DMS_JE_MAIL\)/.test(pakete) &&
      /paketeJeAbschnitt\(neu\)/.test(erstversand) &&
      /paketeJeAbschnitt\(/.test(nachversand) &&
      !/archiviereImDms\(neu\)/.test(erstversand),
  );
  pruefe(
    "Karenz für frisch ausgestellte Zeugnisse: Zähler und Nachversand nutzen dieselbe Bedingung",
    /const DMS_ERSTVERSAND_KARENZ_MS = 2 \* 60_000;/.test(io) &&
      /ausgestelltAm: \{ lt: new Date\(jetzt - DMS_ERSTVERSAND_KARENZ_MS\) \}/.test(helfer("offenImDms")) &&
      // Ohne DMS-Adresse läuft kein Erstversand — dann keine Karenz (Zahl sofort richtig).
      /if \(!dmsAdresse\(\)\) return \{ status: "GUELTIG", dmsGesendetAm: null \};/.test(helfer("offenImDms")) &&
      /prisma\.zeugnis\.count\(\{ where: offenImDms\(\) \}\)/.test(funktion("zaehleOffeneDmsArchivierungen")) &&
      /where: offenImDms\(\),/.test(nachversand) &&
      /prisma\.zeugnis\.count\(\{ where: offenImDms\(\) \}\)/.test(nachversand) &&
      !/dmsGesendetAm: null \}/.test(nachversand),
  );
  pruefe(
    "Nachversand: wirft die Sperr-Transaktion nach gesendeten Kopien, gilt der Stand (kein 500)",
    /catch \(ausnahme\) \{\s*if \(stand\.gesendeteBelege\.length === 0 && stand\.fehlgeschlagen === 0\) throw ausnahme;/.test(nachversand),
  );
  // Seit dem Oberflächenplan (09/2026): Semester (Menü) und Art (Umschalter)
  // sind Links und wirken sofort — eine „angezeigte“ und eine „gewählte“ Auswahl
  // können nicht mehr auseinanderlaufen.
  pruefe(
    "Zeugnisseite: Semester und Art als Links (wirken sofort), kein Wechsel per router.push",
    (() => {
      try {
        const seite = readFileSync("src/app/verwaltung/zeugnisse/page.tsx", "utf8");
        const kopf = readFileSync("src/app/verwaltung/noten/noten-kopf.tsx", "utf8");
        return /<NotenZeugnisseFilter\b/.test(seite) && /<SemesterWahl\b/.test(kopf) && /<Segment\b/.test(seite) && !/router\.push/.test(client);
      } catch {
        return false;
      }
    })(),
  );
  pruefe(
    "„Alle ausstellen“ bleibt aus, solange der Sammellauf gesperrt ist oder nichts auszustellen ist",
    /const sammelAus = sammellauf\.sperre !== null \|\| sammellauf\.auszustellen === 0;/.test(client),
  );
}

console.log("\n14. Fehlerbehandlung: Ausstellung und Downloads (Code-Review 4)");
{
  const lies = (pfad: string) => {
    try {
      return readFileSync(pfad, "utf8");
    } catch {
      return "";
    }
  };
  const ausstellen = lies("src/app/api/zeugnisse/ausstellen/route.ts");
  pruefe(
    "Ausstellung: unerwartete Fehler fängt mitFehlerbehandlung (deutsche Meldung, Log-Präfix [ZEUGNIS])",
    /return mitFehlerbehandlung\("ZEUGNIS", "Das Zeugnis konnte nicht ausgestellt werden\.", async \(\) => \{/.test(ausstellen),
  );
  pruefe(
    "Ausstellung: kein toter default-Zweig mit 500 — nieErreicht meldet vergessene Fehlercodes beim Übersetzen",
    /default:\s*return nieErreicht\(ergebnis\);/.test(ausstellen) && !/default:\s*return fehler\(/.test(ausstellen),
  );
  const downloads = [
    "src/app/api/zeugnisse/[id]/pdf/route.ts",
    "src/app/api/zeugnisse/seriendruck/route.ts",
    "src/app/api/semester/[id]/export/route.ts",
  ];
  const mitRohemJson = downloads.filter((pfad) => {
    const text = lies(pfad);
    return text === "" || /\bfehler\(|nichtAngemeldet\(\)|keineBerechtigung\(\)|return benutzer;/.test(text);
  });
  pruefe("Download-Routen antworten über downloadFehler (kein rohes JSON im Browserfenster)", mitRohemJson.length === 0, mitRohemJson);

  // Verhalten des Helfers selbst — ohne Datenbank, nur Request/Response.
  const klick = (status: number) =>
    downloadFehler(new Request("http://gbs.test/x", { headers: { accept: "text/html,*/*" } }), "Nicht da <b>", status);
  const abruf = downloadFehler(new Request("http://gbs.test/x", { headers: { accept: "*/*" } }), "Nicht da", 404);
  const umleitung = klick(401);
  pruefe(
    "Klick im Browser bei abgelaufener Sitzung: 303 zur Anmeldung",
    umleitung.status === 303 && umleitung.headers.get("location") === "/anmelden",
    { status: umleitung.status, location: umleitung.headers.get("location") },
  );
  const seite = klick(404);
  pruefe(
    "Klick im Browser bei anderem Fehler: HTML-Seite mit demselben Status",
    seite.status === 404 && (seite.headers.get("content-type") ?? "").startsWith("text/html"),
    { status: seite.status, typ: seite.headers.get("content-type") },
  );
  pruefe(
    "fetch/curl (ohne text/html) bekommt weiter JSON { error }",
    abruf.status === 404 && (abruf.headers.get("content-type") ?? "").includes("application/json"),
    { status: abruf.status, typ: abruf.headers.get("content-type") },
  );
}

/** Quelltext lesen — leer, wenn die Datei fehlt (die Prüfungen werden dann rot). */
function quelle(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}

/** Der Quelltext einer exportierten Funktion bis zum nächsten Export. */
function rumpfVon(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const ende = text.indexOf("\nexport ", start + 1);
  return text.slice(start, ende < 0 ? undefined : ende);
}

console.log("\n15. Teilnahmebescheinigung nur mit besuchtem Abend (Hörer)");
{
  const ke = (id: string, titel: string, sortierung: number, fach = "Bibelkunde") => ({ id, titel, sortierung, fach });
  const AT = ke("k-at", "AT-Bibelkunde", 1);
  const NT = ke("k-nt", "NT-Bibelkunde", 2);
  const DOG = ke("k-dog", "Dogmatik I", 3, "Dogmatik");
  const KG = ke("k-kg", "Alte Kirche", 4, "Kirchengeschichte");
  // Bewusst ungeordnet: Die Reihenfolge im Snapshot kommt aus der Sortierung.
  const abende: ErfassterAbend[] = [
    { status: "NACHGEARBEITET", kurseinheit: NT },
    { status: "ENTSCHULDIGT", kurseinheit: DOG },
    { status: "ANWESEND", kurseinheit: AT },
    { status: "GEFEHLT", kurseinheit: KG },
    { status: "ANWESEND", kurseinheit: AT },
    { status: "ANWESEND", kurseinheit: null }, // ein Abend ohne Fach
  ];
  const faecher = bescheinigungsFaecher(abende);
  pruefe(
    "nur Fächer mit einem besuchten Abend, je Kurseinheit einmal, nach Sortierung",
    JSON.stringify(faecher.map((f) => f.titel)) === JSON.stringify(["AT-Bibelkunde", "NT-Bibelkunde"]),
    faecher,
  );
  pruefe("nachgearbeitet zählt als besucht", bescheinigungsFaecher([{ status: "NACHGEARBEITET", kurseinheit: NT }]).length === 1);
  pruefe(
    "entschuldigt und gefehlt zählen nicht",
    bescheinigungsFaecher([
      { status: "ENTSCHULDIGT", kurseinheit: DOG },
      { status: "GEFEHLT", kurseinheit: KG },
    ]).length === 0,
  );
  pruefe("ein Abend ohne Fach bringt kein Fach", bescheinigungsFaecher([{ status: "ANWESEND", kurseinheit: null }]).length === 0);
  pruefe(
    "jedes Fach als „teilgenommen“, ohne Punkte und Note",
    faecher.length === 2 && faecher.every((f) => f.ergebnis === "TEILGENOMMEN" && f.punkte === null && f.note === null),
    faecher,
  );
  pruefe(
    "bei gleicher Sortierung nach Fach (deutsch) geordnet",
    JSON.stringify(
      bescheinigungsFaecher([
        { status: "ANWESEND", kurseinheit: ke("b", "B", 1, "Übungen") },
        { status: "ANWESEND", kurseinheit: ke("a", "A", 1, "Andacht") },
      ]).map((f) => f.fach),
    ) === JSON.stringify(["Andacht", "Übungen"]),
  );
  pruefe(
    "ein besuchter Abend genügt — keine Quote (1 von 10 Abenden)",
    bescheinigungsFaecher([
      { status: "ANWESEND", kurseinheit: DOG },
      ...Array.from({ length: 9 }, () => ({ status: "GEFEHLT", kurseinheit: DOG })),
    ]).length === 1,
  );
  const nichtsBesucht = bescheinigungsFaecher([
    { status: "GEFEHLT", kurseinheit: AT },
    { status: "ENTSCHULDIGT", kurseinheit: NT },
    { status: "ANWESEND", kurseinheit: null },
  ]);
  pruefe("ohne besuchten Abend in einem Fach gibt es keine Bescheinigung", ohneBesuchtenAbend("BESCHEINIGUNG", nichtsBesucht) === true);
  pruefe("mit einem besuchten Fach gibt es eine", ohneBesuchtenAbend("BESCHEINIGUNG", faecher) === false);
  pruefe(
    "Zeugnisse der Schüler betrifft die Regel nicht (auch ohne Fächer)",
    ohneBesuchtenAbend("SEMESTER", []) === false && ohneBesuchtenAbend("ABSCHLUSS", []) === false,
  );
  const s = snap({ typ: "BESCHEINIGUNG", leistungen: faecher });
  pruefe(
    "der Snapshot friert die besuchten Fächer als „teilgenommen“ ein",
    s.leistungen.length === 2 && s.leistungen.every((l) => l.ergebnisText === "teilgenommen"),
    s.leistungen,
  );
  pruefe(
    "die 409-Meldung ist klar und in der Sie-Form",
    MELDUNG_OHNE_ANWESENHEIT.includes("kein besuchter Abend in einem Fach") &&
      MELDUNG_OHNE_ANWESENHEIT.includes("keine Teilnahmebescheinigung") &&
      MELDUNG_OHNE_ANWESENHEIT.includes("tragen Sie bitte") &&
      !/\b(du|dein|deine|dich)\b/i.test(MELDUNG_OHNE_ANWESENHEIT),
    MELDUNG_OHNE_ANWESENHEIT,
  );
}
{
  const zeile = (x: Partial<VorschauZeile>): VorschauZeile => ({
    typ: "BESCHEINIGUNG",
    ausgestellt: false,
    storniert: false,
    besuchteFaecher: 0,
    offeneFaecher: 0,
    bewertet: 0,
    schuelerSemester: 0,
    ...x,
  });
  const v = baueSammelVorschau([zeile({}), zeile({ besuchteFaecher: 3 }), zeile({ ausgestellt: true })]);
  pruefe(
    "Vorschau: Hörer ohne besuchten Abend zählen getrennt, nicht als Bescheinigung",
    v.ohneAnwesenheit === 1 && v.bescheinigungen === 1 && v.vorhanden === 1,
    v,
  );
  const text = sammellaufRueckfrage(v, "SEMESTER", "Herbstsemester 2026");
  pruefe(
    "Rückfrage nennt die Zahl der Hörer ohne besuchten Abend",
    text.includes("1 Hörer hat in diesem Semester keinen besuchten Abend in einem Fach") &&
      text.includes("dafür wird keine Teilnahmebescheinigung ausgestellt"),
    text,
  );
  const m = sammellaufMeldung({ ausgestellt: 1, vorhanden: 1, storniert: 0, ohneAnwesenheit: 2, fehlgeschlagen: 0, gesamt: 4 });
  pruefe(
    "Meldung nach dem Lauf: Hörer ohne Anwesenheit sind kein Fehler, werden aber genannt",
    m.art === "ok" &&
      m.text.startsWith("1 Zeugnis ausgestellt, 1 bereits vorhanden.") &&
      m.text.includes("2 Hörer haben in diesem Semester keinen besuchten Abend"),
    m,
  );
  const nurOhne = sammellaufMeldung({ ausgestellt: 0, vorhanden: 0, storniert: 0, ohneAnwesenheit: 1, fehlgeschlagen: 0, gesamt: 1 });
  pruefe(
    "nichts ausgestellt, nur Hörer ohne Anwesenheit: nicht „bereits ausgestellt“",
    nurOhne.art === "ok" && nurOhne.text.startsWith("Es wurde nichts neu ausgestellt.") && !nurOhne.text.includes("bereits ausgestellt"),
    nurOhne,
  );
}
{
  const io = quelle("src/lib/zeugnis-io.ts");
  const route = quelle("src/app/api/zeugnisse/ausstellen/route.ts");
  pruefe(
    "die Bescheinigung lädt die besuchten Fächer der Person (nicht mehr alle Fächer des Semesters)",
    /if \(typ === "BESCHEINIGUNG"\) \{\s*return \{ abschnitt: semesterBezeichnung, leistungen: await ladeBesuchteFaecher\(personId, semesterId\) \};/.test(
      io,
    ) && !/ladeSemesterFaecher/.test(io),
  );
  pruefe(
    "geladen werden die Abende der Teilnahme an Terminen DIESES Semesters, gezählt über bescheinigungsFaecher",
    /prisma\.anwesenheit\.findMany\(\{\s*where: \{ teilnahme: \{ personId, semesterId \}, termin: \{ semesterId \} \},/.test(io) &&
      /return bescheinigungsFaecher\(abende\.map\(alsErfassterAbend\)\);/.test(io),
  );
  pruefe(
    "ohne besuchten Abend bricht die Ausstellung VOR der Transaktion ab (auch die Neuausstellung)",
    /const inhalt = await sammleInhalt\([^)]*\);\s*(?:\/\/[^\n]*\n\s*)*if \(ohneBesuchtenAbend\(typ, inhalt\.leistungen\)\) return \{ fehler: "ohne_anwesenheit" \};/.test(
      io,
    ) && io.indexOf("ohneBesuchtenAbend(typ, inhalt.leistungen)") < io.indexOf("await prisma.$transaction(async (tx): Promise<{ id: string }"),
  );
  pruefe(
    "der Sammellauf zählt Hörer ohne Anwesenheit getrennt (kein Fehlschlag)",
    /else if \(ergebnis\.fehler === "ohne_anwesenheit"\) ohneAnwesenheit\+\+;/.test(io) &&
      /return \{ ausgestellt: neu\.length, vorhanden, storniert, ohneAnwesenheit, fehlgeschlagen, gesamt: teilnahmen\.length, neu \};/.test(io),
  );
  pruefe("die Einzel-Ausstellung antwortet 409 mit der Meldung", /case "ohne_anwesenheit":\s*return fehler\(MELDUNG_OHNE_ANWESENHEIT, 409\);/.test(route));
  pruefe(
    "Übersicht und Vorschau zählen die besuchten Fächer nach derselben Regel",
    /return new Map\(personIds\.map\(\(id\) => \[id, bescheinigungsFaecher\(jePerson\.get\(id\) \?\? \[\]\)\.length\]\)\);/.test(io) &&
      /zaehleBesuchteFaecher\(semesterId, hoererOhneDokument\)/.test(io) &&
      /besuchteFaecher: z\.besuchteFaecher \?\? 0,/.test(io),
  );
}

console.log("\n16. Storno ohne Ersatz (Grund, Vermerke, Sammellauf, Route)");
pruefe(
  "ohne Grund kein Storno",
  !pruefeStornoGrund(undefined).ok && !pruefeStornoGrund(null).ok && !pruefeStornoGrund("").ok,
);
{
  const leer = pruefeStornoGrund("   \n ");
  pruefe(
    "ein Grund nur aus Leerzeichen gilt als leer (Meldung in der Sie-Form)",
    !leer.ok && leer.meldung === "Bitte geben Sie einen Grund für den Storno an.",
    leer,
  );
  const getrimmt = pruefeStornoGrund("  falsches Semester  ");
  pruefe("der Grund wird getrimmt übernommen", getrimmt.ok && getrimmt.grund === "falsches Semester", getrimmt);
  pruefe(
    "500 Zeichen (nach dem Trimmen) sind erlaubt",
    STORNO_GRUND_MAX_LAENGE === 500 && pruefeStornoGrund(` ${"a".repeat(500)} `).ok,
  );
  const zuLang = pruefeStornoGrund("a".repeat(501));
  pruefe("501 Zeichen sind zu lang", !zuLang.ok && zuLang.meldung.includes("höchstens 500 Zeichen"), zuLang);
}
pruefe(
  "Status-Klartext: gültig / ersetzt / storniert",
  zeugnisStatusName("GUELTIG") === "gültig" && zeugnisStatusName("ERSETZT") === "ersetzt" && zeugnisStatusName("STORNIERT") === "storniert",
);
{
  const r = stornoRueckfrage({ typ: "SEMESTER", belegNr: "ZEU-2026-09-28-AAAA0000", name: "Muster, Max" });
  pruefe(
    "Rückfrage: „Das Zeugnis … wird ungültig und für die Person nicht mehr abrufbar. Es bleibt als Nachweis gespeichert.“",
    r.startsWith(
      "Das Zeugnis ZEU-2026-09-28-AAAA0000 von Muster, Max wird ungültig und für die Person nicht mehr abrufbar. Es bleibt als Nachweis gespeichert.",
    ),
    r,
  );
  const b = stornoRueckfrage({ typ: "BESCHEINIGUNG", belegNr: "BESCH-X", name: "Hörer, Hanna" });
  pruefe(
    "Rückfrage für eine Bescheinigung mit passendem Artikel",
    b.startsWith("Die Teilnahmebescheinigung BESCH-X von Hörer, Hanna wird ungültig") && b.includes("Sie bleibt als Nachweis gespeichert."),
    b,
  );
}
pruefe(
  "410-Text für ein storniertes Zeugnis (Sie-Form); der für ersetzte bleibt",
  ungueltigMeldung("STORNIERT").startsWith("Dieses Zeugnis wurde storniert und ist nicht mehr gültig.") &&
    ungueltigMeldung("STORNIERT").includes("wenden Sie sich") &&
    ungueltigMeldung("ERSETZT").startsWith("Dieses Zeugnis wurde durch eine neue Ausfertigung ersetzt"),
);
pruefe(
  "der Dateiname trägt den Stand (…-UNGUELTIG bzw. …-STORNIERT)",
  zeugnisDateiname("Z", "GUELTIG") === "Z.pdf" &&
    zeugnisDateiname("Z", "ERSETZT") === "Z-UNGUELTIG.pdf" &&
    zeugnisDateiname("Z", "STORNIERT") === "Z-STORNIERT.pdf",
);
{
  const s = snap();
  const mit = baueZeugnisBloecke(s, { storniertAm: "28.09.2026" });
  const kopf = mit[0];
  pruefe(
    "Nachdruck eines stornierten: Kopfvermerk „STORNIERT am … — ungültig“ vor allem anderen",
    kopf.art === "h2" && kopf.text === "STORNIERT am 28.09.2026 — ungültig" && stornoVermerkText({ storniertAm: "28.09.2026" }) === kopf.text,
    kopf,
  );
  const hinweis = mit[1];
  pruefe(
    "… mit neutralem Hinweis ohne Grund; dahinter der unveränderte Snapshot, kein „ersetzt“-Vermerk",
    hinweis.art === "absatz" &&
      hinweis.text.includes("ohne Ersatz zurückgezogen") &&
      JSON.stringify(mit.slice(2)) === JSON.stringify(baueZeugnisBloecke(s)) &&
      !JSON.stringify(mit).includes("UNGÜLTIG – ersetzt"),
    hinweis,
  );
  const v = baueStornoVermerk({ belegNr: "ZEU-2026-09-28-AAAA0000", titel: "Zeugnis", abschnitt: "Herbstsemester 2026", storniertAm: "28.09.2026" });
  pruefe("Storno-Vermerk ans DMS: Betreff nur mit Beleg-Nr. und „ungültig“", v.betreff === "Storno-Vermerk ZEU-2026-09-28-AAAA0000 — ungültig", v.betreff);
  pruefe(
    "Storno-Vermerk: Text und PDF nennen Beleg-Nr., Datum und „ungültig“",
    v.text.includes("Beleg-Nr.: ZEU-2026-09-28-AAAA0000") &&
      v.text.includes("Storniert am: 28.09.2026") &&
      v.text.includes("Status: ungültig") &&
      v.bloecke.some((b) => b.art === "h2" && b.text === "STORNIERT am 28.09.2026 — ungültig") &&
      v.dateiname === "ZEU-2026-09-28-AAAA0000-STORNO.pdf",
    v,
  );
  pruefe("Storno-Vermerk: das PDF entsteht (eine Seite)", seitenzahl(erzeugePdf(v.bloecke)) === 1);
}
pruefe(
  "Storno-Sperre: anonymisiert gesperrt, Endzustand und aktiv nicht",
  (stornoSperreFuerPerson("ANONYMISIERT") ?? "").includes("anonymisiert") &&
    stornoSperreFuerPerson("VERSTORBEN") === null &&
    stornoSperreFuerPerson("AKTIV") === null,
);
{
  const zeile = (x: Partial<VorschauZeile>): VorschauZeile => ({
    typ: "SEMESTER",
    ausgestellt: false,
    storniert: false,
    besuchteFaecher: 0,
    offeneFaecher: 0,
    bewertet: 1,
    schuelerSemester: 1,
    ...x,
  });
  const v = baueSammelVorschau([
    zeile({ storniert: true }),
    zeile({ typ: "BESCHEINIGUNG", storniert: true }), // storniert geht vor „ohne Anwesenheit“
    zeile({ ausgestellt: true, storniert: true }), // ein gültiges geht vor dem stornierten
    zeile({}),
  ]);
  pruefe(
    "Vorschau: Stornierte zählen getrennt und nicht als neue Dokumente; gültig geht vor storniert",
    v.storniert === 2 && v.zeugnisse === 1 && v.vorhanden === 1 && v.ohneAnwesenheit === 0 && v.bescheinigungen === 0,
    v,
  );
  const text = sammellaufRueckfrage(v, "SEMESTER", "Herbstsemester 2026");
  pruefe(
    "Rückfrage nennt die Stornierten — der Sammellauf stellt für sie nichts neu aus",
    text.includes("2 Teilnehmer haben ein storniertes Dokument — dafür stellt der Sammellauf nichts neu aus"),
    text,
  );
  pruefe(
    "Rückfrage nennt „Stornieren“ als Weg zum Zurückziehen (nicht mehr „lässt sich nicht zurücknehmen“)",
    text.includes("zurückziehen über „Stornieren“") && !text.includes("nicht zurücknehmen"),
    text,
  );
  pruefe(
    "Hinweis unter „Alle ausstellen“: nur Vorhandene → „bereits ein Dokument ausgestellt“",
    nichtsAuszustellenHinweis({ ...v, zeugnisse: 0, storniert: 0 }) === "Für alle Teilnehmer ist bereits ein Dokument ausgestellt.",
  );
  const hinweis = nichtsAuszustellenHinweis({ ...v, zeugnisse: 0 });
  pruefe(
    "Hinweis unter „Alle ausstellen“: nennt Stornierte statt „alle ausgestellt“",
    (hinweis ?? "").startsWith("Gesammelt ist nichts mehr auszustellen.") && (hinweis ?? "").includes("storniertes Dokument"),
    hinweis,
  );
  pruefe(
    "kein Hinweis, solange es etwas auszustellen gibt oder niemand da ist",
    nichtsAuszustellenHinweis(v) === null && nichtsAuszustellenHinweis(baueSammelVorschau([])) === null,
  );
  const m = sammellaufMeldung({ ausgestellt: 0, vorhanden: 2, storniert: 1, ohneAnwesenheit: 0, fehlgeschlagen: 0, gesamt: 3 });
  pruefe(
    "Meldung: nichts ausgestellt wegen eines Stornos ist nicht „alle bereits ausgestellt“",
    m.art === "ok" &&
      m.text ===
        "Es wurde nichts neu ausgestellt (2 bereits vorhanden). 1 Teilnehmer hat ein storniertes Dokument — dafür stellt der Sammellauf nichts neu aus (einzeln weiterhin über „Ausstellen“ möglich).",
    m,
  );
}
{
  const io = quelle("src/lib/zeugnis-io.ts");
  const route = quelle("src/app/api/zeugnisse/[id]/stornieren/route.ts");
  const pdfRoute = quelle("src/app/api/zeugnisse/[id]/pdf/route.ts");
  const client = quelle("src/app/verwaltung/zeugnisse/zeugnis-client.tsx");
  const akte = quelle("src/app/verwaltung/personen/[id]/page.tsx");
  const storno = rumpfVon(io, "storniereZeugnis");
  const sammel = rumpfVon(io, "stelleSemesterZeugnisseAus");
  pruefe(
    "Storno-Route: Recht NOTEN_VERWALTEN vor Zod und Grund-Prüfung (400 mit Meldung)",
    /const benutzer = await pruefeZugriff\(RECHT\.NOTEN_VERWALTEN\);[\s\S]{0,200}schema\.safeParse\([\s\S]{0,200}pruefeStornoGrund\(geprueft\.data\.grund\);\s*if \(!grund\.ok\) return fehler\(grund\.meldung, 400\);/.test(
      route,
    ),
  );
  pruefe(
    "Storno-Route: 404 unbekannt, 409 nicht (mehr) gültig bzw. Person anonymisiert",
    /case "fehlt":\s*return fehler\("Dieses Zeugnis gibt es nicht\.", 404\);/.test(route) &&
      /case "nicht_gueltig":\s*return fehler\([\s\S]{0,200}?,\s*409,?\s*\)/.test(route) &&
      /ergebnis\.fehler === "person_gesperrt"\) return fehler\(ergebnis\.meldung, 409\)/.test(route),
  );
  pruefe(
    "Storno-Route: der Vermerk geht NACH der Antwort ans DMS, die Antwort trägt keinen Grund",
    /after\(\(\) => sendeStornoVermerkAnDms\(\{ belegNr, titel, abschnitt, storniertAm \}\)\);/.test(route) &&
      !/return erfolg\([^)]*grund/.test(route),
  );
  pruefe(
    "Storno atomar: bedingtes updateMany auf GUELTIG setzt Status, Zeitpunkt, Akteur und Grund",
    /tx\.zeugnis\.updateMany\(\{\s*where: \{ id: z\.id, status: "GUELTIG" \},\s*data: \{ status: "STORNIERT", storniertAm: jetzt, storniertVonId: akteurId, stornoGrund: grund \},/.test(
      storno,
    ) && /return count === 1 \? "ok" : "nicht_gueltig";/.test(storno),
  );
  pruefe(
    "Storno sperrt die Personenzeile (FOR SHARE) und prüft die Anonymisierung VOR dem Schreiben",
    /SELECT "statusCode" FROM "personen" WHERE "id" = \$\{z\.personId\} FOR SHARE[\s\S]{0,200}stornoSperreFuerPerson\(zeile\.statusCode\)[\s\S]{0,120}tx\.zeugnis\.updateMany\(/.test(
      storno,
    ),
  );
  const auditStart = storno.indexOf("protokolliere({");
  const audit = auditStart < 0 ? "" : storno.slice(auditStart, storno.indexOf("});", auditStart));
  pruefe(
    "Audit ZEUGNIS_STORNIERT mit Beleg-Nr., Typ und grundAngegeben — ohne den Grundtext",
    /aktion: "ZEUGNIS_STORNIERT"/.test(audit) &&
      /nachher: \{ status: "STORNIERT", belegNr: z\.belegNr, typ: z\.typ, grundAngegeben: true \}/.test(audit) &&
      !/\bgrund\b(?!Angegeben)|stornoGrund/.test(audit),
    audit,
  );
  pruefe(
    "Storno-Vermerk: nur mit DMS-Adresse, über sendeBelegAnDms, best effort (fängt selbst)",
    /const an = dmsAdresse\(\);\s*if \(!an\) return;\s*try \{\s*const vermerk = baueStornoVermerk\(/.test(rumpfVon(io, "sendeStornoVermerkAnDms")) &&
      /await sendeBelegAnDms\(an, \{/.test(rumpfVon(io, "sendeStornoVermerkAnDms")) &&
      /\} catch \(fehler\) \{/.test(rumpfVon(io, "sendeStornoVermerkAnDms")),
  );
  pruefe(
    "PDF-Route: ein storniertes ohne NOTEN_VERWALTEN → 410 mit eigenem Text, Datei mit Stand",
    /if \(!gueltig && !darfAlle\) \{\s*return downloadFehler\(request, ungueltigMeldung\(dokument\.status\), 410\);/.test(pdfRoute) &&
      /filename="\$\{zeugnisDateiname\(dokument\.belegNr, dokument\.status\)\}"/.test(pdfRoute),
  );
  pruefe(
    "Nachdruck: STORNIERT bekommt den Storno-Vermerk, ERSETZT den Ersetzt-Vermerk",
    /if \(dokument\.status === "STORNIERT"\) \{\s*vermerk = \{ storniertAm: datum\(dokument\.storniertAm\) \};\s*\} else if \(dokument\.status === "ERSETZT"\) \{/.test(io),
  );
  pruefe(
    "Sammellauf: lädt gültige UND stornierte und überspringt Stornierte vor der Ausstellung",
    /status: \{ in: \["GUELTIG", "STORNIERT"\] \}/.test(sammel) &&
      /if \(stornierte\.has\(schluessel\)\) \{\s*storniert\+\+;\s*continue;\s*\}/.test(sammel) &&
      sammel.indexOf("stornierte.has(schluessel)") < sammel.indexOf("fuehreAusstellungAus("),
  );
  pruefe(
    "Neuausstellung: das bisherige wird nur bedingt (noch GUELTIG) ersetzt — ein zeitgleicher Storno gewinnt",
    /const entwertet = await tx\.zeugnis\.updateMany\(\{ where: \{ id: alt\.id, status: "GUELTIG" \}, data: \{ status: "ERSETZT" \} \}\);\s*if \(entwertet\.count !== 1\) return \{ geaendert: true \};/.test(
      io,
    ) && !/tx\.zeugnis\.update\(\{ where: \{ id: alt\.id \}/.test(io),
  );
  pruefe(
    "Seriendruck, /meine-daten und DMS-Nachversand erfassen nur GUELTIG",
    /prisma\.zeugnis\.findMany\(\{ where: \{ id: \{ in: ids \}, status: "GUELTIG" \}, select: \{ snapshot: true \} \}\)/.test(rumpfVon(io, "erzeugeSeriendruckPdf")) &&
      /where: \{ personId, status: "GUELTIG" \}/.test(rumpfVon(io, "ladeEigeneZeugnisse")) &&
      (io.match(/return \{\s*status: "GUELTIG",\s*dmsGesendetAm: null,/g) ?? []).length === 1,
  );
  pruefe(
    "Oberfläche: „Stornieren“ nur an gültigen — Zeugnisseite im Zweig des gültigen Zeugnisses, Detailakte über stornierbar",
    /<ZeugnisStorno\s+zeugnisId=\{z\.zeugnis\.id\}\s+stornierbar\s/.test(client) &&
      /stornierbar=\{z\.status === "GUELTIG" && !istAnonym\}/.test(akte) &&
      /ladeZeugnisseDerPerson\(person\.id\)/.test(akte),
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 177;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

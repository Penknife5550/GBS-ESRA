/**
 * Gegenprobe für das Dozentenhonorar (DB-frei): die Satz-Auflösung nach Datum
 * (Historie mit Gültig-ab), die Rechnung/Formatierung, der DMS-Beleg und die
 * hinterlegte Grundlage (abgelöste Einstellung + neues Recht).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import { euro, satzFuer, HONORAR_SATZ_FALLBACK, type SatzZeile } from "../src/lib/honorar";
import { baueHonorarBelegBloecke, type HonorarBelegDaten } from "../src/lib/honorar-beleg";
import { erzeugePdf } from "../src/lib/pdf";

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

const d = (iso: string) => new Date(iso);

console.log("\n1. Satz-Auflösung nach Datum (Historie mit Gültig-ab)");
pruefe("leere Historie ⇒ Rückfallsatz", satzFuer(d("2026-09-01"), []) === HONORAR_SATZ_FALLBACK);
const einer: SatzZeile[] = [{ betrag: 60, gueltigAb: d("2000-01-01"), genehmigtAm: d("2000-01-01") }];
pruefe("ein Satz ab 2000 gilt für jeden späteren Abend", satzFuer(d("2026-09-01"), einer) === 60);
const zwei: SatzZeile[] = [
  { betrag: 60, gueltigAb: d("2000-01-01"), genehmigtAm: d("2000-01-01") },
  { betrag: 70, gueltigAb: d("2026-09-01"), genehmigtAm: d("2026-06-01") },
];
pruefe("Abend VOR der Erhöhung nimmt den alten Satz (60)", satzFuer(d("2026-08-31"), zwei) === 60);
pruefe("Abend AM Gültig-ab-Tag nimmt den neuen Satz (70)", satzFuer(d("2026-09-01"), zwei) === 70);
pruefe("Abend NACH der Erhöhung nimmt den neuen Satz (70)", satzFuer(d("2026-12-01"), zwei) === 70);
const mitZukunft: SatzZeile[] = [
  ...zwei,
  { betrag: 80, gueltigAb: d("2027-09-01"), genehmigtAm: d("2027-06-01") },
];
pruefe("ein künftiger Satz gilt noch nicht (80 ab 2027 ⇒ 2026 bleibt 70)", satzFuer(d("2026-12-01"), mitZukunft) === 70);
pruefe("die Eingabeliste darf unsortiert sein", satzFuer(d("2026-12-01"), [...mitZukunft].reverse()) === 70);
const gleichertag: SatzZeile[] = [
  { betrag: 60, gueltigAb: d("2026-09-01"), genehmigtAm: d("2026-06-01") },
  { betrag: 65, gueltigAb: d("2026-09-01"), genehmigtAm: d("2026-07-01") }, // Korrektur, später genehmigt
];
pruefe("bei gleichem Gültig-ab gewinnt die zuletzt genehmigte Zeile (65)", satzFuer(d("2026-10-01"), gleichertag) === 65);
const abZukunft: SatzZeile[] = [{ betrag: 90, gueltigAb: d("2026-09-01"), genehmigtAm: d("2026-06-01") }];
pruefe("Abend vor dem ersten Satz ⇒ Rückfallsatz", satzFuer(d("2026-01-01"), abZukunft) === HONORAR_SATZ_FALLBACK);

console.log("\n2. Euro-Formatierung");
pruefe("600 wird zu 600 €", euro(600) === "600 €");
pruefe("0 wird zu 0 €", euro(0) === "0 €");
pruefe("Tausender bekommen einen Punkt (1.260 €)", euro(1260) === "1.260 €");

console.log("\n3. DMS-Beleg (komplette Historie + Unterrichtstage je Fach und Satz)");
const belegDaten: HonorarBelegDaten = {
  belegNr: "HON-2026-07-30-ABCD1234",
  erzeugtAm: d("2026-07-30T10:00:00"),
  genehmigtVon: "Muster, Max",
  genehmigtAm: d("2026-07-30T10:00:00"),
  anlass: "70 € je Unterrichtsabend, gültig ab 01.09.2026",
  saetze: [
    { betrag: 70, gueltigAb: d("2026-09-01"), notiz: "Beschluss 2026-06", genehmigtVon: "Muster, Max", genehmigtAm: d("2026-07-30T10:00:00") },
    { betrag: 60, gueltigAb: d("2000-01-01"), notiz: null, genehmigtVon: null, genehmigtAm: d("2000-01-01") },
  ],
  tage: [
    { datum: d("2026-09-01T17:00:00"), semester: "Herbstsemester 2026", fach: "Bibelkunde", satz: 70 },
    { datum: d("2026-09-08T17:00:00"), semester: "Herbstsemester 2026", fach: "Dogmatik", satz: 70 },
  ],
};
const bloecke = baueHonorarBelegBloecke(belegDaten);
const alsText = JSON.stringify(bloecke);
pruefe("der Beleg hat einen Titel-Block", bloecke.some((b) => b.art === "titel"));
pruefe("die Beleg-Nummer steht im Beleg", alsText.includes("HON-2026-07-30-ABCD1234"));
pruefe("der Genehmiger steht im Beleg", alsText.includes("Muster, Max"));
pruefe("die Satz-Historie enthält beide Sätze", alsText.includes("70 €") && alsText.includes("60 €"));
pruefe("die Unterrichtstage nennen das Fach", alsText.includes("Bibelkunde") && alsText.includes("Dogmatik"));
const pdf = erzeugePdf(bloecke);
pruefe("erzeugePdf liefert eine gültige PDF (Kopf %PDF)", pdf.subarray(0, 5).toString("latin1") === "%PDF-");
pruefe("die PDF ist nicht leer", pdf.length > 500);

console.log("\n4. Der frühere Einzel-Regler ist abgelöst, der Rückfallsatz steht im Code");
let honorarSrc = "";
try {
  honorarSrc = readFileSync("src/lib/honorar.ts", "utf8");
} catch {
  honorarSrc = "";
}
let einstellungen = "";
try {
  einstellungen = readFileSync("src/lib/einstellungen.ts", "utf8");
} catch {
  einstellungen = "";
}
pruefe("honorar.ts ist lesbar", honorarSrc.length > 0);
pruefe("HONORAR_SATZ_FALLBACK ist als Konstante hinterlegt und = 60", /HONORAR_SATZ_FALLBACK = 60\b/.test(honorarSrc));
pruefe("HONORAR_SATZ_PRO_ABEND ist NICHT mehr eine Einstellung", !/HONORAR_SATZ_PRO_ABEND:\s*\{/.test(einstellungen));

console.log("\n5. Das Recht HONORAR_SATZ_GENEHMIGEN ist geseedet und den richtigen Rollen zugeordnet");
let seed = "";
try {
  seed = readFileSync("prisma/seed.ts", "utf8");
} catch {
  seed = "";
}
function rechteVon(rolle: string): string {
  const treffer = seed.match(new RegExp(`code: "${rolle}"[\\s\\S]*?rechte: \\[([^\\]]*)\\]`));
  return treffer ? treffer[1] : "";
}
pruefe("seed.ts ist lesbar", seed.length > 0);
pruefe(
  "HONORAR_SATZ_GENEHMIGEN ist als Recht im Bereich FINANZEN angelegt",
  /code: "HONORAR_SATZ_GENEHMIGEN"[\s\S]{0,120}bereich: "FINANZEN"/.test(seed),
);
pruefe("die Schulleitung darf Sätze genehmigen", rechteVon("SCHULLEITER").includes("HONORAR_SATZ_GENEHMIGEN"));
pruefe("die Verwaltung darf Sätze genehmigen", rechteVon("VERWALTUNG").includes("HONORAR_SATZ_GENEHMIGEN"));
pruefe(
  "der Teilnehmer darf Sätze NICHT genehmigen",
  rechteVon("TEILNEHMER").length > 0 && !rechteVon("TEILNEHMER").includes("HONORAR_SATZ_GENEHMIGEN"),
);
pruefe("der Seed legt die erste Historien-Zeile aus dem Altwert an", /honorarSatz\.create/.test(seed));
pruefe(
  "der Seed entfernt die abgelöste Einstellung (per deleteMany)",
  /einstellung\.deleteMany\([\s\S]{0,80}schluessel: "HONORAR_SATZ_PRO_ABEND"/.test(seed),
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 30;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

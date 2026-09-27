/**
 * Gegenprobe für das Dozentenhonorar (DB-frei): die Satz-Auflösung nach Datum
 * (Historie mit Gültig-ab), die Rechnung/Formatierung, der DMS-Beleg, die
 * hinterlegte Grundlage (abgelöste Einstellung + neues Recht), der
 * Nachversand eines nicht angekommenen Satz-Belegs (Code-Review 4, M12), die
 * Beleg-Nr aus dem Berliner Kalendertag, die Posten-Bildung über einen
 * Satzwechsel und die Datumsprüfung der Honorar-Routen.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import { bauePosten, euro, honorarBelegNr, satzFuer, HONORAR_SATZ_FALLBACK, type SatzZeile } from "../src/lib/honorar";
import {
  baueHonorarBelegBloecke,
  baueSatzDmsMail,
  historieBis,
  type HonorarBelegDaten,
} from "../src/lib/honorar-beleg";
import { pruefeSatzNachversand } from "../src/lib/honorar-korrektur";
import { alsTagesdatum } from "../src/lib/semester";
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
pruefe("der Erstbeleg trägt keinen Nachversand-Vermerk", !alsText.includes("NACHVERSAND"));
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
  /code: RECHT\.HONORAR_SATZ_GENEHMIGEN,[\s\S]{0,120}bereich: "FINANZEN"/.test(seed),
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

console.log("\n6. Nachversand des Satz-Belegs (M12)");
const historie = [
  { betrag: 60, genehmigtAm: d("2026-01-01T10:00:00Z") },
  { betrag: 70, genehmigtAm: d("2026-06-01T10:00:00Z") },
  { betrag: 80, genehmigtAm: d("2026-09-01T10:00:00Z") },
];
pruefe(
  "historieBis lässt später genehmigte Sätze weg (Beleg einer älteren Genehmigung)",
  historieBis(historie, d("2026-06-01T10:00:00Z")).map((s) => s.betrag).join(",") === "60,70",
  historieBis(historie, d("2026-06-01T10:00:00Z")),
);
pruefe(
  "historieBis nimmt die auslösende Genehmigung selbst mit (gleicher Zeitpunkt)",
  historieBis(historie, d("2026-09-01T10:00:00Z")).length === 3,
);
const satzMailErst = baueSatzDmsMail({ belegNr: "HON-2026-07-30-ABCD1234", anlass: "70 € je Unterrichtsabend", genehmigtVon: "Muster, Max" }, false);
const satzMailNach = baueSatzDmsMail({ belegNr: "HON-2026-07-30-ABCD1234", anlass: "70 € je Unterrichtsabend", genehmigtVon: "Muster, Max" }, true);
pruefe(
  "die Satz-Mail trägt Beleg-Nr und Anlass im Betreff, den Genehmiger im Text",
  satzMailErst.betreff.includes("HON-2026-07-30-ABCD1234") && satzMailErst.betreff.includes("70 €") && satzMailErst.text.includes("Muster, Max"),
  satzMailErst,
);
pruefe("Erstversand: ohne Nachversand-Vermerk", !satzMailErst.betreff.includes("Nachversand") && !satzMailErst.text.includes("NACHVERSAND"));
pruefe(
  "Nachversand: Vermerk im Betreff, dieselbe Beleg-Nr und der Hinweis auf eine mögliche Kopie im Text",
  satzMailNach.betreff.includes("Nachversand") && satzMailNach.betreff.includes("HON-2026-07-30-ABCD1234") && satzMailNach.text.includes("Kopie"),
  satzMailNach,
);
pruefe("der Anhang heißt wie die Beleg-Nr", satzMailNach.dateiname === "HON-2026-07-30-ABCD1234.pdf");
const nachBeleg = JSON.stringify(baueHonorarBelegBloecke({ ...belegDaten, nachversand: true }));
pruefe(
  "Nachversand: das PDF selbst trägt den Kopie-Vermerk mit der Beleg-Nr (nicht nur die Mail)",
  nachBeleg.includes("NACHVERSAND") && nachBeleg.includes("Kopie des Belegs HON-2026-07-30-ABCD1234"),
);
pruefe("ein nicht angekommener Satz-Beleg ist nachsendbar", pruefeSatzNachversand({ dmsBelegNr: "HON-X", dmsGesendetAm: null }) === null);
pruefe("ein gesendeter Satz-Beleg nicht (kein zweiter Versand)", pruefeSatzNachversand({ dmsBelegNr: "HON-X", dmsGesendetAm: d("2026-07-30") }) !== null);
pruefe("ein Satz ohne Beleg-Nr (Altwert aus dem Seed) nicht", pruefeSatzNachversand({ dmsBelegNr: null, dmsGesendetAm: null }) !== null);
function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}
const honorarIo = lies("src/lib/honorar-io.ts");
pruefe(
  "Genehmigung und Nachversand senden über denselben Weg (versendeSatzBeleg) unter der Advisory-Lock-Sperre",
  (honorarIo.match(/versendeSatzBeleg\(/g) ?? []).length >= 3 &&
    /mitDmsSperre\(`honorar-satz:/.test(honorarIo) &&
    /pg_try_advisory_xact_lock/.test(lies("src/lib/dms.ts")),
);
const satzNachsendeRoute = lies("src/app/api/honorar/saetze/[id]/beleg-senden/route.ts");
pruefe(
  "die Nachsende-Route für Sätze verlangt HONORAR_SATZ_GENEHMIGEN und ruft sendeSatzBelegNach",
  /RECHT\.HONORAR_SATZ_GENEHMIGEN/.test(satzNachsendeRoute) && /sendeSatzBelegNach\(/.test(satzNachsendeRoute),
);
const saetzeSeite = lies("src/app/verwaltung/honorar/saetze/page.tsx");
pruefe("die Sätze-Seite bietet „Beleg erneut senden“ an", /<BelegNachsendenKnopf/.test(saetzeSeite));
pruefe(
  "ohne DMS-Adresse zeigt die Sätze-Seite statt des Knopfs den Grund (dmsAdresse() → DMS_NICHT_EINGERICHTET)",
  /dmsAdresse\(\)/.test(saetzeSeite) && /dmsEingerichtet \?\s*\(\s*<BelegNachsendenKnopf/.test(saetzeSeite) && /\{DMS_NICHT_EINGERICHTET\}/.test(saetzeSeite),
);
pruefe(
  "versendeSatzBeleg reicht den Nachversand in die Beleg-Daten (Vermerk im PDF)",
  /ladeBelegDaten\(tx,[^;]*\)\), nachversand \}/.test(honorarIo),
);
const belegDatenFn = honorarIo.split("async function ladeBelegDaten(")[1]?.split("\n}\n")[0] ?? "";
pruefe(
  "unter der Sperre liest der Satz-Versand über die Transaktion (tx), nicht über den globalen Client",
  belegDatenFn.length > 0 &&
    !/prisma\./.test(belegDatenFn) &&
    /ladeBelegDaten\(tx,/.test(honorarIo) &&
    /ladeAkteurNamen\(\[satz\.genehmigtVonId\], tx\)/.test(honorarIo),
);
pruefe(
  "scheitert nach der angenommenen Mail die Sperr-Transaktion, wird dmsGesendetAm bedingt nachgetragen",
  /honorarSatz\.updateMany\(\{ where: \{ id: satzId, dmsGesendetAm: null \}/.test(honorarIo) && /if \(!am\) throw fehler;/.test(honorarIo),
);

console.log("\n7. Beleg-Nr aus dem Berliner Kalendertag (nicht UTC)");
const zufall = "abcd1234-5678-4abc-9def-0123456789ab";
pruefe(
  "Sommerzeit: 30.07. 22:30 UTC ist in Berlin schon der 31.07.",
  honorarBelegNr("HONA", d("2026-07-30T22:30:00Z"), zufall) === "HONA-2026-07-31-ABCD1234",
  honorarBelegNr("HONA", d("2026-07-30T22:30:00Z"), zufall),
);
pruefe(
  "Winterzeit: 15.01. 23:30 UTC ist in Berlin schon der 16.01.",
  honorarBelegNr("HON", d("2026-01-15T23:30:00Z"), zufall) === "HON-2026-01-16-ABCD1234",
  honorarBelegNr("HON", d("2026-01-15T23:30:00Z"), zufall),
);
pruefe(
  "tagsüber derselbe Tag; die ersten acht Zeichen des Zufallsteils groß",
  honorarBelegNr("HON", d("2026-07-30T10:00:00Z"), "1a2b3c4d-0000") === "HON-2026-07-30-1A2B3C4D",
  honorarBelegNr("HON", d("2026-07-30T10:00:00Z"), "1a2b3c4d-0000"),
);
const abrIo = lies("src/lib/honorar-abrechnung-io.ts");
pruefe(
  "Genehmigung und Freigabe vergeben die Beleg-Nr über honorarBelegNr (keine UTC-Kopie mehr)",
  /honorarBelegNr\("HON", /.test(honorarIo) &&
    /honorarBelegNr\("HONA", /.test(abrIo) &&
    !/function neueBelegNr/.test(honorarIo + abrIo),
);
{
  // Eine Regel für alle Belege (beleg-nr.ts) und ein Versandweg ins DMS (dms.ts):
  // Honorar und Zeugnis bauen die Nummer nicht mehr mit eigener
  // Datumsformatierung, und das Zeugnismodul hängt nicht mehr am Honorarmodul.
  const honorarKern = lies("src/lib/honorar.ts");
  const zeugnisKern = lies("src/lib/zeugnis.ts");
  const zeugnisIo = lies("src/lib/zeugnis-io.ts");
  pruefe(
    "Honorar- und Zeugnis-Beleg-Nr über belegNummer (beleg-nr.ts), ohne eigene Datumsformatierung",
    /return belegNummer\(praefix, am, zufall\);/.test(honorarKern) &&
      /return belegNummer\(belegNrPraefix\(typ\), am, zufall\);/.test(zeugnisKern) &&
      !/Intl\.DateTimeFormat/.test(honorarKern + zeugnisKern) &&
      /export function belegNummer\(/.test(lies("src/lib/beleg-nr.ts")),
  );
  pruefe(
    "alle drei Belegwege senden über sendeBelegAnDms; das Zeugnismodul importiert nichts aus honorar-io",
    [honorarIo, abrIo, zeugnisIo].every((q) => /sendeBelegAnDms\(an, /.test(q) && !/\bsendeMail\(/.test(q)) &&
      !/from "@\/lib\/honorar-io"/.test(zeugnisIo),
  );
}

console.log("\n8. Posten-Bildung über einen Satzwechsel (Einfrieren)");
const saetzeWechsel: SatzZeile[] = [
  { betrag: 60, gueltigAb: d("2000-01-01"), genehmigtAm: d("2000-01-01") },
  { betrag: 70, gueltigAb: d("2026-09-01"), genehmigtAm: d("2026-06-01") },
];
const wechsel = bauePosten(
  [
    { terminId: "t1", beginn: d("2026-08-31T17:00:00Z"), fach: "Bibelkunde" },
    { terminId: "t2", beginn: d("2026-09-01T17:00:00Z"), fach: "Kirchengeschichte" },
  ],
  saetzeWechsel,
);
pruefe(
  "Abende beidseits eines Gültig-ab in EINER Abrechnung: je Abend der damals geltende Satz (60/70)",
  wechsel.posten.map((p) => p.betrag).join(",") === "60,70",
  wechsel.posten,
);
pruefe("die Summe ist die Summe der Posten (130, nicht 2 × ein Satz)", wechsel.summe === 130, wechsel.summe);
pruefe(
  "Termin, Datum und Fach gehen unverändert in den Posten",
  wechsel.posten[0]?.terminId === "t1" &&
    wechsel.posten[1]?.fach === "Kirchengeschichte" &&
    wechsel.posten[1]?.datum.toISOString() === "2026-09-01T17:00:00.000Z",
  wechsel.posten,
);
pruefe("ohne offene Abende: keine Posten, Summe 0", bauePosten([], saetzeWechsel).summe === 0 && bauePosten([], saetzeWechsel).posten.length === 0);
const erstelleFn = abrIo.split("export async function erstelleAbrechnung(")[1]?.split("\n}\n")[0] ?? "";
pruefe(
  "erstelleAbrechnung bildet Posten und Summe über bauePosten und speichert genau diese",
  /bauePosten\(/.test(erstelleFn) && /summe,/.test(erstelleFn) && /posten: \{ create: posten \}/.test(erstelleFn),
);
const nachDemAnlegen = abrIo.split("export async function ladeAbrechnung(")[1] ?? "";
pruefe(
  "eingefroren: Detail, Beleg, Freigabe und Auszahlung rechnen nicht neu (kein satzFuer/bauePosten nach dem Anlegen)",
  nachDemAnlegen.length > 0 && !/satzFuer\(|bauePosten\(/.test(nachDemAnlegen),
);

console.log("\n9. Datumsprüfung der Honorar-Routen (geprüfter Kalendertag-Parser)");
pruefe("30.02. ist kein Tag (kein stiller Roll-over auf den 02.03.)", alsTagesdatum("2026-02-30") === null);
pruefe("29.02. im Schaltjahr ist gültig", alsTagesdatum("2028-02-29")?.toISOString().slice(0, 10) === "2028-02-29");
const auszahlenRoute = lies("src/app/api/honorar/abrechnungen/[id]/auszahlen/route.ts");
const satzRoute = lies("src/app/api/honorar/saetze/route.ts");
pruefe(
  "die Auszahlen-Route prüft das Datum mit alsTagesdatum (null → 400), ohne eigene Round-Trip-Kopie",
  /const ausgezahltAm = alsTagesdatum\(/.test(auszahlenRoute) &&
    /if \(!ausgezahltAm\) return fehler\([^;]*, 400\)/.test(auszahlenRoute) &&
    !/toISOString\(\)/.test(auszahlenRoute),
);
pruefe(
  "die Satz-Route prüft Gültig-ab mit alsTagesdatum (null → 400), ohne eigene Round-Trip-Kopie",
  /const gueltigAb = alsTagesdatum\(/.test(satzRoute) &&
    /if \(!gueltigAb\) return fehler\([^;]*, 400\)/.test(satzRoute) &&
    !/toISOString\(\)/.test(satzRoute),
);

console.log("\n10. Oberfläche: Rückfrage vor der Genehmigung, aktueller Hilfetext");
const satzFormQuelle = lies("src/app/verwaltung/honorar/saetze/satz-form.tsx");
pruefe(
  "das Satz-Formular fragt vor der (lohnwirksamen) Genehmigung mit Betrag und Gültig-ab nach",
  /if \(\s*!confirm\(\s*`\$\{euro\(Number\(betrag\)\)\} je Unterrichtsabend ab \$\{tagDeutsch\(gueltigAb\)\}/.test(satzFormQuelle),
);
const uebersichtSeite = lies("src/app/verwaltung/honorar/page.tsx");
pruefe(
  "die Honorar-Übersicht verspricht keine „spätere“ Auszahlung mehr, sondern verweist auf „Abrechnungen“",
  uebersichtSeite.length > 0 && !/späteren\s+Schritt/.test(uebersichtSeite) && /unter „Abrechnungen“/.test(uebersichtSeite),
);
pruefe(
  "die Honorar-Übersicht rechnet abgerechnete Abende mit dem eingefrorenen Posten-Betrag (wie der Zahlungsbeleg), nur offene live",
  /abrechnungPosten: \{ select: \{ betrag: true \} \}/.test(honorarIo) &&
    /eintrag\.betrag \+= t\.abrechnungPosten \? t\.abrechnungPosten\.betrag : satzFuer\(t\.beginn, saetze\);/.test(honorarIo),
);
pruefe(
  "die Sätze-Seite verspricht nicht mehr, vergangene Beträge blieben bei einem rückdatierten Satz unverändert",
  !/verändert vergangene Beträge nicht/.test(saetzeSeite) && /verändert bereits abgerechnete Beträge nicht/.test(saetzeSeite),
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 68;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

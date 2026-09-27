/**
 * Gegenprobe für die Navigation (Oberflächenplan 09/2026), DB-frei.
 *
 * Die Regeln stehen in src/lib/navigation.ts: welcher Bereich (Verwaltung,
 * Dozent, Teilnehmer), welche Punkte ein Konto sieht und welcher Punkt auf
 * einer Seite als aktiv gilt. Dazu die Verdrahtung: jede Leiste zeigt auf eine
 * Seite, die es gibt, und die drei Layouts setzen den Rahmen ein.
 *
 * Jede Prüfung muss rot werden, wenn die Regel fehlt — deshalb auch die
 * Grenzfälle (etwa „/verwaltung/personenliste“ liegt nicht unter „/verwaltung/personen“).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RECHT, type RechtCode } from "../src/lib/constants";
import { kalenderTeile, tagKurz, tagLang, uhrzeit } from "../src/lib/datum";
import {
  DOZENT_NAV,
  EIGENE_DATEN_PFAD,
  MEIN_UNTERRICHT,
  TEILNEHMER_NAV,
  VERWALTUNG_HAUPT,
  VERWALTUNG_WEITERE,
  aktiverPunkt,
  bereichFuer,
  initialen,
  liegtUnter,
  rollenBezeichnung,
  sichtbarePunkte,
} from "../src/lib/navigation";

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

const mit = (...rechte: RechtCode[]) => (recht: RechtCode) => rechte.includes(recht);
const schluessel = (punkte: readonly { schluessel: string }[]) => punkte.map((p) => p.schluessel).join(",");
// Wie die übrigen Prüfskripte: Aufruf aus dem Anwendungsordner (pruefe-alle.ts setzt ihn).
const WURZEL = process.cwd();
function lies(pfad: string): string {
  try {
    return readFileSync(join(WURZEL, pfad), "utf8");
  } catch {
    return "";
  }
}

console.log("\n1. Bereich je Konto (dieselbe Weiche wie früher auf der Startseite)");
pruefe("wer alle Personen lesen darf, arbeitet in der Verwaltung", bereichFuer(mit(RECHT.PERSON_LESEN_ALLE)) === "verwaltung");
pruefe(
  "Schulleitung, die unterrichtet, bleibt in der Verwaltung",
  bereichFuer(mit(RECHT.PERSON_LESEN_ALLE, RECHT.EIGENE_TERMINE_LESEN)) === "verwaltung",
);
pruefe("wer nur eigene Abende hat, ist Dozent", bereichFuer(mit(RECHT.EIGENE_TERMINE_LESEN, RECHT.PERSON_LESEN_EIGENE)) === "dozent");
pruefe("alle anderen sind Teilnehmer", bereichFuer(mit(RECHT.PERSON_LESEN_EIGENE)) === "teilnehmer");

console.log("\n2. Sichtbare Punkte je Recht");
const schulleitung = mit(
  RECHT.PERSON_LESEN_ALLE,
  RECHT.ANMELDUNG_LESEN,
  RECHT.SEMESTER_VERWALTEN,
  RECHT.NOTEN_VERWALTEN,
  RECHT.HONORAR_LESEN,
  RECHT.FORMULAR_BEARBEITEN,
  RECHT.AUDIT_LESEN,
  RECHT.EIGENE_TERMINE_LESEN,
);
pruefe(
  "die Schulleitung sieht alle sechs Hauptbereiche in fester Reihenfolge",
  schluessel(sichtbarePunkte(VERWALTUNG_HAUPT, schulleitung)) === "heute,anmeldungen,personen,unterricht,noten,semester",
  schluessel(sichtbarePunkte(VERWALTUNG_HAUPT, schulleitung)),
);
pruefe(
  "ohne Notenrecht kein Punkt „Noten & Zeugnisse“",
  !schluessel(sichtbarePunkte(VERWALTUNG_HAUPT, mit(RECHT.PERSON_LESEN_ALLE, RECHT.SEMESTER_VERWALTEN))).includes("noten"),
);
pruefe(
  "ohne Anmelderecht kein Punkt „Anmeldungen“",
  !schluessel(sichtbarePunkte(VERWALTUNG_HAUPT, mit(RECHT.PERSON_LESEN_ALLE))).includes("anmeldungen"),
);
pruefe(
  "Einstellungen und Betrieb nur mit Systemrecht",
  schluessel(sichtbarePunkte(VERWALTUNG_WEITERE, schulleitung)) === "honorar,formulare,protokoll" &&
    schluessel(sichtbarePunkte(VERWALTUNG_WEITERE, mit(RECHT.SYSTEM_EINSTELLUNGEN))) === "einstellungen,betrieb",
);
pruefe(
  "„Mein Unterricht“ sieht, wer eigene Abende hat — auch die Schulleitung",
  sichtbarePunkte([MEIN_UNTERRICHT], schulleitung).length === 1 &&
    sichtbarePunkte([MEIN_UNTERRICHT], mit(RECHT.PERSON_LESEN_ALLE)).length === 0,
);

console.log("\n3. Aktiver Punkt (längster passender Pfad)");
const verwaltung = [...VERWALTUNG_HAUPT, ...VERWALTUNG_WEITERE, MEIN_UNTERRICHT];
const faelle: [string, string | null][] = [
  ["/verwaltung", "heute"],
  ["/verwaltung/personen", "personen"],
  ["/verwaltung/personen/0b8d3e0a-1111-4222-8333-944455556666", "personen"],
  ["/verwaltung/teilnehmer", "personen"],
  ["/verwaltung/anmeldungen/0b8d3e0a-1111-4222-8333-944455556666", "anmeldungen"],
  ["/verwaltung/zeugnisse", "noten"],
  ["/verwaltung/semesterueberleitung", "semester"],
  ["/verwaltung/faecher", "semester"],
  ["/verwaltung/honorar/abrechnungen/1", "honorar"],
  ["/dozent", "mein-unterricht"],
  ["/meine-daten", null],
];
for (const [pfad, erwartet] of faelle) {
  pruefe(`${pfad} → ${erwartet ?? "keiner"}`, aktiverPunkt(verwaltung, pfad) === erwartet, aktiverPunkt(verwaltung, pfad));
}
pruefe(
  "Grenze: „/verwaltung/personenliste“ liegt nicht unter „/verwaltung/personen“",
  !liegtUnter("/verwaltung/personenliste", "/verwaltung/personen") && aktiverPunkt(verwaltung, "/verwaltung/personenliste") === "heute",
);
pruefe(
  "Teilnehmer: Übersicht, Abende und Ich (auch für die E-Mail-Bestätigung)",
  aktiverPunkt(TEILNEHMER_NAV, "/meine-daten") === "uebersicht" &&
    aktiverPunkt(TEILNEHMER_NAV, "/meine-daten/abende") === "abende" &&
    aktiverPunkt(TEILNEHMER_NAV, "/meine-daten/ich") === "ich" &&
    aktiverPunkt(TEILNEHMER_NAV, "/meine-daten/email") === "ich",
);
pruefe(
  "Dozent: Unterricht, Noten und Ich (dort gehören auch die eigenen Daten hin)",
  aktiverPunkt(DOZENT_NAV, "/dozent") === "unterricht" &&
    aktiverPunkt(DOZENT_NAV, "/dozent/noten") === "noten" &&
    aktiverPunkt(DOZENT_NAV, "/meine-daten") === "ich",
);

console.log("\n4. Verdrahtung");
const allePunkte = [...VERWALTUNG_HAUPT, ...VERWALTUNG_WEITERE, MEIN_UNTERRICHT, ...DOZENT_NAV, ...TEILNEHMER_NAV];
const ohneSeite = allePunkte.filter((p) => !existsSync(join(WURZEL, "src/app", p.pfad, "page.tsx"))).map((p) => p.pfad);
pruefe("jeder Punkt der Leisten führt auf eine Seite, die es gibt", ohneSeite.length === 0, ohneSeite);
pruefe(
  "„Meine Daten“ im Profil führt auf eine Seite, die es gibt",
  existsSync(join(WURZEL, "src/app", EIGENE_DATEN_PFAD, "page.tsx")),
);
for (const bereich of ["verwaltung", "dozent", "meine-daten"]) {
  pruefe(`das Layout unter /${bereich} setzt den Rahmen ein`, /<AppRahmen>\{children\}<\/AppRahmen>/.test(lies(`src/app/${bereich}/layout.tsx`)));
}
const rahmen = lies("src/components/rahmen/app-rahmen.tsx");
pruefe(
  "der Rahmen zeigt offene Anmeldungen als Zahl und nur mit Anmelderecht",
  /hat\(RECHT\.ANMELDUNG_LESEN\)\s*\?\s*prisma\.anmeldung\.count\(\{ where: \{ status: "EINGEREICHT" \} \}\)/.test(rahmen) &&
    /schluessel === "anmeldungen" \? \{ \.\.\.punkt, zahl: offeneAnmeldungen \}/.test(rahmen),
);
pruefe("ohne Anmeldung zeichnet der Rahmen nichts dazu", /if \(!benutzer\) return <>\{children\}<\/>;/.test(rahmen));
const suche = lies("src/components/rahmen/suchfeld.tsx");
pruefe(
  "die Suche in der Leiste sucht über alle Personen (Parameter „suche“, „ansicht=alle“)",
  /action="\/verwaltung\/personen"/.test(suche) && /name="suche"/.test(suche) && /name="ansicht" value="alle"/.test(suche),
);

console.log("\n5. Profil und Datumsanzeige");
pruefe("Rolle: die höchste zuerst", rollenBezeichnung(["DOZENT", "SCHULLEITER", "ADMIN"]) === "Schulleitung");
pruefe(
  "Rolle: Verwaltung, Administration, Dozent, Teilnehmer, sonst „Konto“",
  rollenBezeichnung(["VERWALTUNG"]) === "Verwaltung" &&
    rollenBezeichnung(["ADMIN"]) === "Administration" &&
    rollenBezeichnung(["GASTDOZENT"]) === "Dozent" &&
    rollenBezeichnung(["TEILNEHMER"]) === "Teilnehmer" &&
    rollenBezeichnung([]) === "Konto",
);
pruefe(
  "Initialen, auch mit Umlauten und leeren Namen",
  initialen("Andreas", "Klassen") === "AK" && initialen("özlem", "ünal") === "ÖÜ" && initialen(" ", "") === "?",
);
const abend = new Date("2026-09-29T17:00:00.000Z"); // Di 29.09.2026, 19:00 Berliner Sommerzeit
pruefe("tagLang: „Dienstag, 29. September“", tagLang(abend) === "Dienstag, 29. September", tagLang(abend));
pruefe("tagKurz: „Di., 29.09.“", tagKurz(abend) === "Di., 29.09.", tagKurz(abend));
pruefe("uhrzeit in Berliner Zeit: „19:00“ (auch im Winter)", uhrzeit(abend) === "19:00" && uhrzeit(new Date("2026-11-03T18:00:00.000Z")) === "19:00");
const teile = kalenderTeile(abend);
pruefe("Kalenderblock: „DI“, „29“ und der Monat", teile.wochentag === "DI" && teile.tag === "29" && teile.monat.startsWith("Sep"), teile);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 39;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

/**
 * Gegenprobe für die Anonymisierungs-Kernlogik (DSGVO Art. 17), DB-frei.
 *
 * Abschnitte 4–9 kamen mit Code-Review 4 (M6/M7) dazu: Zeugnis-Snapshots,
 * Betreffs im Versandprotokoll, Audit ohne Klardaten und — am Quelltext wie in
 * pruefe-honorar.ts — dass die Transaktion diese Stellen auch wirklich anfasst
 * und kein anderer Schreibweg eine Anonymisierung unterläuft.
 * Aufruf aus dem Anwendungsordner (relative Pfade).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import {
  ANONYM_PLATZHALTER,
  anonymEmail,
  anonymePersonFelder,
  betreffSuchbegriffe,
  geaenderteFeldnamen,
  scrubbeAntworten,
  scrubbeZeugnisSnapshot,
} from "../src/lib/anonymisierung";

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

function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}

console.log("\n1. Platzhalter-Adresse");
pruefe("die Adresse enthält die Person-Id (eindeutig)", anonymEmail("abc-123").includes("abc-123"));
pruefe("die Adresse endet auf @anonymisiert.invalid", anonymEmail("abc-123").endsWith("@anonymisiert.invalid"));
pruefe("verschiedene Personen bekommen verschiedene Adressen", anonymEmail("a") !== anonymEmail("b"));

console.log("\n2. Überschriebene Person-Felder");
const jetzt = new Date("2026-09-27T10:00:00.000Z");
const felder = anonymePersonFelder("abc-123", jetzt);
pruefe("der Name wird überschrieben", felder.vorname === "Anonymisiert" && felder.nachname === "Person");
pruefe("die E-Mail wird zur Platzhalter-Adresse", felder.email === anonymEmail("abc-123"));
pruefe("IBAN und Kontoinhaber werden geleert", felder.ibanVerschluesselt === null && felder.kontoinhaber === null);
pruefe(
  "Kontakt- und Stammdaten werden geleert",
  felder.telefon === null &&
    felder.strasse === null &&
    felder.plz === null &&
    felder.ort === null &&
    felder.geburtsdatum === null &&
    felder.gemeinde === null &&
    felder.notiz === null,
);
pruefe("ein gesetztes Passwort wird entfernt", felder.passwortHash === null);
pruefe(
  "passwortGeaendertAm wird auf JETZT gesetzt (beendet alle Sitzungen), nicht geleert",
  felder.passwortGeaendertAm instanceof Date && felder.passwortGeaendertAm.getTime() === jetzt.getTime(),
  felder.passwortGeaendertAm,
);
pruefe(
  "der Status steht NICHT in den Feldern (er wechselt nur über wechsleStatus)",
  !("statusCode" in felder),
);
pruefe("die Ehepartner-Kopplung wird gelöst", felder.ehepartnerId === null);

console.log("\n3. Anmelde-Antworten (Voll-Scrub)");
const antworten = { vorname: "Max", iban: "DE89370400440532013000", glaube_bekenntnis: "Seit meiner Jugend." };
const gescrubbt = scrubbeAntworten(antworten);
pruefe("jede Antwort wird zum Platzhalter", Object.values(gescrubbt).every((w) => w === ANONYM_PLATZHALTER));
pruefe(
  "keine ursprüngliche Angabe bleibt übrig",
  !JSON.stringify(gescrubbt).includes("Max") && !JSON.stringify(gescrubbt).includes("DE89"),
  gescrubbt,
);
pruefe(
  "die Schlüssel und ihre Anzahl bleiben erhalten",
  Object.keys(gescrubbt).length === 3 && "iban" in gescrubbt && "glaube_bekenntnis" in gescrubbt,
);

console.log("\n4. Zeugnis-Snapshot (M6a)");
const snapshot = {
  snapshotVersion: 1,
  belegNr: "ZEU-2026-09-27-ABCD1234",
  typ: "SEMESTER",
  titel: "Semesterzeugnis",
  version: 1,
  ersetztBelegNr: null,
  person: { name: "Muster, Maximilian", geburtsdatum: "03.04.1990", anschrift: "Hauptstraße 1" },
  abschnitt: "Herbstsemester 2026",
  leistungen: [{ fach: "Bibelkunde", titel: "AT", ergebnis: "BESTANDEN", ergebnisText: "bestanden", punkte: 12, note: "2" }],
  ausgestelltAm: "27.09.2026",
  ausgestelltVon: "Schulleitung",
  ort: "Minden",
};
const vorherJson = JSON.stringify(snapshot);
const zeugnis = scrubbeZeugnisSnapshot(snapshot) as Record<string, unknown> & {
  person: { name: unknown; geburtsdatum: unknown };
};
pruefe(
  "der Name wird zum Platzhalter, das Geburtsdatum zu null",
  zeugnis.person.name === ANONYM_PLATZHALTER && zeugnis.person.geburtsdatum === null,
  zeugnis.person,
);
pruefe(
  "kein Name, kein Geburtsdatum und kein weiteres Personenfeld bleibt im Snapshot",
  !/Muster|Maximilian|03\.04\.1990|Hauptstraße/.test(JSON.stringify(zeugnis)),
  zeugnis,
);
pruefe(
  "Beleg-Nr., Fächer, Ergebnisse, Abschnitt und Aussteller bleiben als Nachweis",
  zeugnis.belegNr === snapshot.belegNr &&
    JSON.stringify(zeugnis.leistungen) === JSON.stringify(snapshot.leistungen) &&
    zeugnis.abschnitt === snapshot.abschnitt &&
    zeugnis.ausgestelltVon === snapshot.ausgestelltVon &&
    zeugnis.typ === snapshot.typ,
);
pruefe("das übergebene Objekt bleibt unverändert (reine Funktion)", JSON.stringify(snapshot) === vorherJson);

console.log("\n5. Betreffs im Versandprotokoll (M6b)");
{
  const gruppen = betreffSuchbegriffe({ vorname: " Klaus ", nachname: "Ehemann", email: "klaus@beispiel.de" });
  pruefe(
    "Vor- und Nachname werden nur GEMEINSAM gesucht (Namensvettern bleiben unberührt)",
    gruppen.some((g) => g.length === 2 && g[0] === "Klaus" && g[1] === "Ehemann"),
    gruppen,
  );
  pruefe("die Adresse ist eine eigene Alternative", gruppen.some((g) => g.length === 1 && g[0] === "klaus@beispiel.de"), gruppen);
  const leer = betreffSuchbegriffe({ vorname: "  ", nachname: "Ehemann", email: "" });
  pruefe(
    "leere Teile ergeben keinen Suchbegriff (ein leerer träfe jede Zeile)",
    leer.length === 0 && !leer.flat().includes(""),
    leer,
  );
}

console.log("\n6. Audit ohne Klardaten (M6c)");
{
  const namen = geaenderteFeldnamen(
    { vorname: "Max", strasse: "Alte Straße 1", telefon: "0571 1", ort: "Minden" },
    { vorname: "Max", strasse: "Neue Straße 7", telefon: null, ort: undefined },
  );
  pruefe("nur geänderte Felder, geleert zählt, nicht mitgeschickt nicht", namen.join(",") === "strasse,telefon", namen);
  pruefe("die Ausgabe enthält keine Werte", !JSON.stringify(namen).includes("Straße"), namen);
  const datum = geaenderteFeldnamen(
    { geburtsdatum: new Date("1990-04-03T00:00:00.000Z") },
    { geburtsdatum: new Date("1990-04-03T00:00:00.000Z") },
  );
  pruefe("gleiche Daten in verschiedenen Objekten gelten als unverändert", datum.length === 0, datum);
}

console.log("\n7. Die Transaktion fasst alle Stellen an (Quelltext, M6/M7)");
const io = lies("src/lib/anonymisierung-io.ts");
pruefe("anonymisierung-io.ts ist lesbar", io.length > 0);
pruefe(
  "Zeugnis-Snapshots werden in der Transaktion überschrieben",
  /tx\.zeugnis\.update\([\s\S]{0,200}scrubbeZeugnisSnapshot\(/.test(io),
);
pruefe(
  "Betreffs mit Namen werden unabhängig von der personId bereinigt",
  /betreffSuchbegriffe\(/.test(io) && /updateMany\(\{\s*where: \{ OR: betreffTreffer \},\s*data: \{ betreff: ANONYM_PLATZHALTER \}/.test(io),
);
pruefe("die Rollen der Person werden entfernt", /tx\.personRolle\.deleteMany\(\{ where: \{ personId \} \}\)/.test(io));
pruefe(
  "offene Anmeldungen (ENTWURF/EINGEREICHT) werden auf ABGELEHNT geschlossen (M7)",
  /tx\.anmeldung\.updateMany\(\{\s*where: \{ personId, status: \{ in: \[AnmeldungStatus\.ENTWURF, AnmeldungStatus\.EINGEREICHT\] \} \},\s*data: \{\s*status: AnmeldungStatus\.ABGELEHNT/.test(io),
);
pruefe(
  "der Status wechselt bedingt über wechsleStatus in derselben Transaktion",
  /wechsleStatus\(\{\s*tx,/.test(io) && !/statusCode:\s*STATUS\.ANONYMISIERT/.test(io),
);
const entscheiden = lies("src/app/api/anmeldungen/[id]/entscheiden/route.ts");
pruefe(
  "die Aufnahme schreibt den Personenstatus nur bedingt (wechsleStatus) und lehnt Anonymisierte ab (M7)",
  /wechsleStatus\(\{\s*tx,/.test(entscheiden) &&
    !/statusCode:\s*"ANGENOMMEN"/.test(entscheiden) &&
    /person\.statusCode === STATUS\.ANONYMISIERT/.test(entscheiden),
);
pruefe(
  "Fehlertexte mit der Adresse werden unabhängig von der personId bereinigt",
  /updateMany\(\{\s*where: \{ fehler: \{ contains: person\.email, mode: "insensitive" \} \},\s*data: \{ fehler: ANONYM_PLATZHALTER \}/.test(
    io,
  ) && !/where: \{ personId, fehler:/.test(io),
);
pruefe(
  "Drosselzeilen mit der Adresse (MAGIC_LINK:…, PASSWORT:…) werden gelöscht",
  /`MAGIC_LINK:\$\{adresse\}`, `PASSWORT:\$\{adresse\}`/.test(io) &&
    /tx\.rateLimit\.deleteMany\(\{ where: \{ schluessel: \{ in: drosselSchluessel \} \} \}\)/.test(io),
);
{
  // Sperrreihenfolge wie „Annehmen" und Adressänderung: erst die Zeilen an der
  // Person, dann die Personenzeile — sonst Deadlock.
  const personSperre = io.indexOf("const wechsel = await wechsleStatus(");
  const vorher = ["tx.anmeldung.updateMany(", "tx.magicLink.deleteMany(", "tx.emailAenderung.deleteMany("];
  pruefe(
    "offene Anmeldungen und Adresslinks werden VOR der Personenzeile gesperrt (keine Deadlocks)",
    personSperre > 0 && vorher.every((stelle) => io.indexOf(stelle) > 0 && io.indexOf(stelle) < personSperre),
    vorher.map((stelle) => [stelle, io.indexOf(stelle), personSperre]),
  );
}
pruefe(
  "ein Deadlock (P2034) wird in Anonymisierung und Aufnahme zu 409 statt 500",
  /ausnahme\.code === "P2034"\) \{\s*return \{ status: "gleichzeitig" \}/.test(io) &&
    /ausnahme\.code === "P2034"\) \{\s*return fehler\([^)]*, 409\)/.test(entscheiden),
);
{
  const zeugnisIo = lies("src/lib/zeugnis-io.ts");
  pruefe(
    "die Zeugnisausstellung sperrt die Personenzeile und prüft den Status IN der Transaktion",
    /\$transaction\(async \(tx\)[\s\S]{0,900}SELECT "statusCode" FROM "personen" WHERE "id" = \$\{personId\} FOR SHARE[\s\S]{0,400}zeugnisSperreFuerPerson\(status\)[\s\S]{0,700}tx\.zeugnis\.create\(/.test(
      zeugnisIo,
    ),
  );
}
pruefe(
  "Noten für Personen im Endzustand (auch Anonymisierte) nimmt der Schreibweg nicht an",
  /const ziele = await prisma\.teilnahme\.findMany\(\{\s*where: \{ semesterId, person: \{ status: \{ istTerminal: false \} \} \}/.test(
    lies("src/lib/leistung-io.ts"),
  ),
);

console.log("\n8. Andere Schreibwege unterlaufen die Anonymisierung nicht (Quelltext)");
// Prüfen-dann-Schreiben reicht nicht: Committet die Anonymisierung zwischen dem
// Lesen und dem Schreiben, stünden Name, Anschrift, IBAN oder Rollen wieder im
// gelöschten Datensatz. Die Bedingung gehört IN die schreibende Anweisung.
const BEDINGT = /person\.updateMany\(\{\s*where: \{ id(?:: person\.id)?, statusCode: \{ not: STATUS\.ANONYMISIERT \} \}/;
const SCHREIBWEGE = [
  "src/app/api/personen/[id]/stammdaten/route.ts",
  "src/app/api/personen/[id]/email/route.ts",
  "src/app/api/personen/[id]/rollen/route.ts",
  "src/app/api/personen/[id]/ausbildungsdaten/route.ts",
  "src/app/api/meine-daten/route.ts",
];
const unbedingt = SCHREIBWEGE.filter((pfad) => {
  const text = lies(pfad);
  return !BEDINGT.test(text) || /(?:prisma|tx)\.person\.update\(/.test(text);
});
pruefe(
  "Stammdaten, Anmeldeadresse, Rollen, Ausbildungsdaten und Selbstpflege schreiben nur bedingt (nicht anonymisiert)",
  unbedingt.length === 0,
  unbedingt,
);
{
  const email = lies("src/app/api/personen/[id]/email/route.ts");
  pruefe(
    "die Adressänderung entwertet erst die Links, dann die Person (Sperrreihenfolge wie die Anonymisierung)",
    email.indexOf("prisma.emailAenderung.updateMany(") > 0 &&
      email.indexOf("prisma.emailAenderung.updateMany(") < email.indexOf("prisma.person.updateMany("),
  );
}

console.log("\n9. Kein Protokoll-Eintrag mit Personenwerten (Quelltext, M6c)");
// Jeder protokolliere({…})-Aufruf in den Personen- und Selbstpflege-Wegen:
// kein Schlüssel mit Personenwert und keine durchgereichten vorher/nachher-Objekte.
const AUDIT_DATEIEN = [
  "src/app/api/personen/route.ts",
  "src/app/api/personen/[id]/stammdaten/route.ts",
  "src/app/api/personen/[id]/bankverbindung/route.ts",
  "src/app/api/personen/[id]/email/route.ts",
  "src/app/api/personen/[id]/anmeldelink/route.ts",
  "src/app/api/personen/[id]/auskunft/route.ts",
  "src/app/api/personen/[id]/ausbildungsdaten/route.ts",
  "src/app/api/personen/[id]/rollen/route.ts",
  "src/app/api/meine-daten/route.ts",
  "src/app/api/meine-daten/email/route.ts",
  "src/app/api/meine-daten/email/bestaetigen/route.ts",
  "src/app/api/auth/passwort/route.ts",
  "src/app/api/zugang-hilfe/route.ts",
  "src/lib/anmeldung.ts",
  "src/lib/selbstpflege.ts",
  "src/lib/anonymisierung-io.ts",
  "src/lib/status-io.ts",
];
// Schlüssel mit Personenwert — auch in der Kurzschreibweise `{ email }` bzw.
// `{ vorname, nachname }`, die ohne Doppelpunkt auskommt.
const PERSONENWERT_SCHLUESSEL =
  /[{,]\s*(vorname|nachname|name|email|neueEmail|empfaenger|strasse|plz|ort|telefon|geburtsdatum|gemeinde|kontoinhaber|iban|person)\s*[:,}]/;
pruefe(
  "die Suche erkennt auch die Kurzschreibweise ({ email }, { vorname, nachname }) und Schlüssel mit Wert",
  PERSONENWERT_SCHLUESSEL.test("nachher: { email },") &&
    PERSONENWERT_SCHLUESSEL.test("nachher: { vorname, nachname }") &&
    PERSONENWERT_SCHLUESSEL.test("vorher: { strasse: person.strasse }") &&
    !PERSONENWERT_SCHLUESSEL.test("nachher: { geaenderteFelder: [\"email\"], empfaengerAnzahl: 2, personStatus: x }"),
);
const bloecke = AUDIT_DATEIEN.flatMap((pfad) =>
  lies(pfad)
    .split("protokolliere({")
    .slice(1)
    .map((rest) => ({ pfad, block: rest.slice(0, Math.max(0, rest.indexOf("});"))) })),
);
pruefe(
  "die Protokoll-Aufrufe werden gefunden (auch in Passwort-Anmeldung und Hilfeformular)",
  bloecke.length >= 20 && bloecke.some((b) => b.pfad.endsWith("auth/passwort/route.ts")),
  bloecke.length,
);
const mitWerten = bloecke.filter(
  (b) => PERSONENWERT_SCHLUESSEL.test(b.block) || /^\s*(vorher|nachher),?\s*$/m.test(b.block),
);
pruefe(
  "kein Protokoll-Eintrag trägt Name, Adresse, Telefon, E-Mail, Geburtsdatum, Gemeinde oder IBAN",
  mitWerten.length === 0,
  mitWerten.map((b) => b.pfad),
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 43;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

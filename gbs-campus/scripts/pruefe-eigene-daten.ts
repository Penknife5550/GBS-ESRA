/**
 * Gegenprobe für die Selbstpflege der eigenen Akte.
 *
 * Ohne Datenbank, ohne Test-Framework — dieselbe Bauart wie
 * `pruefe-formularlogik.ts` und `pruefe-semesterlogik.ts`, läuft über
 * `npm run pruefen` mit.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Regel in
 * `src/lib/eigene-daten.ts` auskommentieren, Skript laufen lassen — bleibt es
 * grün, prüft die neue Zeile nicht das, was sie behauptet.
 */

import { readFileSync } from "fs";
import {
  FELD_BEZEICHNUNG,
  geaenderteFelder,
  pruefeEigeneDaten,
  pruefeNeueEmail,
} from "../src/lib/eigene-daten";
import { hilfeMeldung, pruefeHilfeAnfrage } from "../src/lib/zugang-hilfe";

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

/** Enthält die Mängelliste eine Meldung zu diesem Feld? */
function meldetFeld(ergebnis: ReturnType<typeof pruefeEigeneDaten>, feld: string): boolean {
  return !ergebnis.ok && ergebnis.meldungen.some((m) => m.feld === feld);
}

const VOLLSTAENDIG = {
  telefon: "0571 123456",
  strasse: "Hauptstraße 1",
  plz: "32423",
  ort: "Minden",
  kontoinhaber: "Petra Beispiel",
};

console.log("\n1. Stammdaten");
const sauber = pruefeEigeneDaten(VOLLSTAENDIG);
pruefe("vollständige Angaben werden angenommen", sauber.ok, sauber.ok ? undefined : sauber);
// Geprüft wird der WERT des gepolsterten Ergebnisses, nicht der des sauberen.
// Vorher stand hier `sauber.werte.ort === "Minden"` (der Text war nie
// gepolstert) und für den gepolsterten Fall nur `.ok` — beides blieb grün, wenn
// man das `.trim()` aus `text()` entfernte. Genau die Tautologie aus dem Review.
const gepolstert = pruefeEigeneDaten({ ...VOLLSTAENDIG, ort: "  Minden  ", strasse: "  Hauptstraße 1  " });
pruefe(
  "Leerzeichen am Rand werden entfernt",
  gepolstert.ok && gepolstert.werte.ort === "Minden" && gepolstert.werte.strasse === "Hauptstraße 1",
  gepolstert.ok ? gepolstert.werte : gepolstert,
);
pruefe(
  "leere Felder werden zu null, nicht zu leerem Text",
  (() => {
    const leer = pruefeEigeneDaten({ telefon: "", strasse: null, plz: undefined, ort: "", kontoinhaber: "" });
    return leer.ok && leer.werte.telefon === null && leer.werte.ort === null && leer.werte.plz === null;
  })(),
);
pruefe("Buchstaben in der Telefonnummer werden abgewiesen", meldetFeld(pruefeEigeneDaten({ telefon: "ruf mich an" }), "telefon"));
pruefe("zu kurze Postleitzahl wird abgewiesen", meldetFeld(pruefeEigeneDaten({ plz: "32" }), "plz"));
pruefe("überlange Straße wird abgewiesen", meldetFeld(pruefeEigeneDaten({ strasse: "A".repeat(121) }), "strasse"));
pruefe("einzeichiger Ort wird abgewiesen", meldetFeld(pruefeEigeneDaten({ ort: "M" }), "ort"));

console.log("\n2. Bankverbindung — leer heißt unverändert, nicht löschen");
const ohneIban = pruefeEigeneDaten(VOLLSTAENDIG);
pruefe("ohne Eingabe wird keine IBAN gesetzt", ohneIban.ok && ohneIban.werte.iban === undefined);
const leereIban = pruefeEigeneDaten({ ...VOLLSTAENDIG, iban: "   " });
pruefe("nur Leerzeichen setzen keine IBAN", leereIban.ok && leereIban.werte.iban === undefined);
pruefe(
  "Zahlendreher in der IBAN wird erkannt",
  meldetFeld(pruefeEigeneDaten({ iban: "DE89 3704 0044 0532 0130 09" }), "iban"),
);
const guteIban = pruefeEigeneDaten({ ...VOLLSTAENDIG, iban: "de89 3704 0044 0532 0130 00" });
pruefe(
  "gültige IBAN wird normalisiert übernommen",
  guteIban.ok && guteIban.werte.iban === "DE89370400440532013000",
  guteIban.ok ? guteIban.werte.iban : guteIban,
);

console.log("\n3. E-Mail-Adresse");
pruefe("gültige neue Adresse wird angenommen", pruefeNeueEmail("Neu@Beispiel.DE", "alt@beispiel.de").ok);
pruefe(
  "Adresse wird kleingeschrieben",
  (() => {
    const e = pruefeNeueEmail("Neu@Beispiel.DE", "alt@beispiel.de");
    return e.ok && e.email === "neu@beispiel.de";
  })(),
);
pruefe("Adresse ohne @ wird abgewiesen", !pruefeNeueEmail("keine-adresse", "alt@beispiel.de").ok);
pruefe("Adresse ohne Punkt in der Domain wird abgewiesen", !pruefeNeueEmail("wer@localhost", "alt@beispiel.de").ok);
pruefe("überlange Adresse wird abgewiesen", !pruefeNeueEmail(`${"a".repeat(115)}@beispiel.de`, "alt@beispiel.de").ok);
pruefe("Zahl statt Text wird abgewiesen", !pruefeNeueEmail(42, "alt@beispiel.de").ok);
// Sonst verschickt das System eine Bestätigungsmail für eine Änderung, die
// keine ist — und der Empfänger fragt sich, was da gerade passiert.
pruefe("die bereits hinterlegte Adresse wird abgewiesen", !pruefeNeueEmail("alt@beispiel.de", "alt@beispiel.de").ok);
pruefe(
  "auch mit anderer Groß-/Kleinschreibung ist es dieselbe Adresse",
  !pruefeNeueEmail("ALT@Beispiel.de", "alt@beispiel.de").ok,
);

console.log("\n4. Was hat sich geändert?");
const vorher = { telefon: "0571 1", strasse: "Alt 1", plz: "32423", ort: "Minden", kontoinhaber: null, iban: null };
pruefe(
  "unveränderte Angaben melden nichts",
  geaenderteFelder(vorher, { telefon: "0571 1", strasse: "Alt 1", plz: "32423", ort: "Minden" }).length === 0,
);
pruefe(
  "geänderte Straße wird gemeldet",
  geaenderteFelder(vorher, { strasse: "Neu 2" }).join() === "Straße",
  geaenderteFelder(vorher, { strasse: "Neu 2" }),
);
pruefe(
  "geleertes Feld gilt als Änderung",
  geaenderteFelder(vorher, { telefon: null }).join() === "Telefonnummer",
);
pruefe(
  "nicht mitgeschicktes Feld gilt nicht als Änderung",
  geaenderteFelder(vorher, { telefon: undefined }).length === 0,
);
pruefe(
  "neue Bankverbindung wird gemeldet",
  geaenderteFelder(vorher, { iban: "neu" }).join() === "Bankverbindung",
);
pruefe(
  "mehrere Änderungen werden alle gemeldet",
  geaenderteFelder(vorher, { strasse: "Neu 2", ort: "Porta" }).length === 2,
);
pruefe("die Bezeichnungen sind deutsch und lesbar", FELD_BEZEICHNUNG.iban === "Bankverbindung");

console.log("\n5. Die E-Mail-Adresse läuft nicht über die Sofort-Speicherung");
// Wäre "email" Teil von pruefeEigeneDaten, würde die Adresse ohne Bestätigung
// gesetzt — und ein Tippfehler speerrte das Konto dauerhaft aus.
const mitEmail = pruefeEigeneDaten({ ...VOLLSTAENDIG, email: "neu@beispiel.de" } as never);
pruefe(
  "eine mitgeschickte E-Mail-Adresse wird nicht übernommen",
  mitEmail.ok && !("email" in mitEmail.werte),
  mitEmail.ok ? mitEmail.werte : mitEmail,
);

let quelltext = "";
try {
  quelltext = readFileSync("src/app/api/meine-daten/route.ts", "utf8");
} catch {
  quelltext = "";
}
pruefe("Quelltext der Speicher-Route ist lesbar", quelltext.length > 0);
pruefe(
  "die Speicher-Route schreibt kein E-Mail-Feld",
  quelltext.length > 0 && !/^\s*email:/m.test(quelltext),
);

console.log("\n6. „Ich komme nicht mehr rein“");
const ANFRAGE = {
  vorname: "Petra",
  nachname: "Beispiel",
  bisherigeEmail: "alt@beispiel.de",
  erreichbarEmail: "neu@beispiel.de",
  erreichbarTelefon: null,
  nachricht: "Mein altes Postfach ist abgeschaltet.",
};

function meldetHilfeFeld(ergebnis: ReturnType<typeof pruefeHilfeAnfrage>, feld: string): boolean {
  return !ergebnis.ok && ergebnis.meldungen.some((m) => m.feld === feld);
}

const anfrageOk = pruefeHilfeAnfrage(ANFRAGE);
pruefe("vollständige Meldung wird angenommen", anfrageOk.ok, anfrageOk.ok ? undefined : anfrageOk);
pruefe("ohne Vornamen wird abgewiesen", meldetHilfeFeld(pruefeHilfeAnfrage({ ...ANFRAGE, vorname: "  " }), "vorname"));
pruefe("ohne Nachnamen wird abgewiesen", meldetHilfeFeld(pruefeHilfeAnfrage({ ...ANFRAGE, nachname: "" }), "nachname"));
// Ohne Rückweg wäre die Meldung wertlos: Die Schule könnte niemanden erreichen,
// der Wartende hielte seine Bitte aber für unterwegs.
pruefe(
  "ohne jede Erreichbarkeit wird abgewiesen",
  meldetHilfeFeld(pruefeHilfeAnfrage({ ...ANFRAGE, erreichbarEmail: null, erreichbarTelefon: null }), "erreichbarEmail"),
);
pruefe(
  "nur eine Telefonnummer reicht",
  pruefeHilfeAnfrage({ ...ANFRAGE, erreichbarEmail: null, erreichbarTelefon: "0571 123456" }).ok,
);
pruefe(
  "unsinnige Erreichbarkeitsadresse wird abgewiesen",
  meldetHilfeFeld(pruefeHilfeAnfrage({ ...ANFRAGE, erreichbarEmail: "keine-adresse" }), "erreichbarEmail"),
);
pruefe(
  "Buchstaben in der Telefonnummer werden abgewiesen",
  meldetHilfeFeld(
    pruefeHilfeAnfrage({ ...ANFRAGE, erreichbarEmail: null, erreichbarTelefon: "ruf mich an" }),
    "erreichbarTelefon",
  ),
);
pruefe(
  "überlange Mitteilung wird abgewiesen",
  meldetHilfeFeld(pruefeHilfeAnfrage({ ...ANFRAGE, nachricht: "x".repeat(1001) }), "nachricht"),
);
pruefe(
  "Adressen werden kleingeschrieben",
  (() => {
    const e = pruefeHilfeAnfrage({ ...ANFRAGE, erreichbarEmail: "NEU@Beispiel.DE" });
    return e.ok && e.werte.erreichbarEmail === "neu@beispiel.de";
  })(),
);

if (anfrageOk.ok) {
  const meldung = hilfeMeldung(anfrageOk.werte);
  pruefe("die Meldung nennt den Namen", meldung.includes("Petra Beispiel"));
  pruefe("die Meldung nennt die Erreichbarkeit", meldung.includes("neu@beispiel.de"));
  // Der wichtigste Satz der ganzen Meldung: Wer daraufhin eine Adresse ändert,
  // muss wissen, dass hier jeder jeden Namen eintragen kann.
  pruefe("die Meldung warnt ausdrücklich, dass die Angaben ungeprüft sind", meldung.includes("ungeprüft"));
  pruefe("die Meldung erklärt den nächsten Schritt", meldung.includes("Verwaltung → Personen"));
}

const ohneNachricht = pruefeHilfeAnfrage({ ...ANFRAGE, nachricht: null });
pruefe(
  "eine Meldung ohne Mitteilung bleibt lesbar",
  ohneNachricht.ok && !hilfeMeldung(ohneNachricht.werte).includes("Mitteilung:"),
);

let hilfeQuelltext = "";
try {
  hilfeQuelltext = readFileSync("src/app/api/zugang-hilfe/route.ts", "utf8");
} catch {
  hilfeQuelltext = "";
}
pruefe("Quelltext der Hilfe-Route ist lesbar", hilfeQuelltext.length > 0);
// Die Route darf melden, nicht handeln. Ein `person.update` hier wäre eine
// Kontoübernahme per öffentlichem Formular.
pruefe(
  "die öffentliche Hilfe-Route ändert keine Person",
  hilfeQuelltext.length > 0 && !/person\.(update|create|delete)/.test(hilfeQuelltext),
);

// Soll-Anzahl. Ohne sie verschwindet eine Prüfung lautlos, sobald ein
// `if (…ok)`-Block nicht mehr betreten wird — der Lauf meldet dann einfach
// weniger Zeilen und trotzdem „0 fehlgeschlagen". Beim Ergänzen einer Prüfung
// gehört diese Zahl mit angehoben; das ist der Zweck.
const ERWARTET = 46;
// `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
// Zeile — `pruefe` zählt erst im Rumpf hoch. Deshalb wird hier ausdrücklich um
// eins vorgegriffen, damit sich die Prüfung selbst mitzählt.
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

/**
 * Gegenprobe für die Formular-Fachlogik.
 *
 * Kein Test-Framework, weil in Release 0.1 noch keines eingerichtet ist — das
 * Skript prüft dieselben Dinge und läuft mit `npx tsx scripts/pruefe-formularlogik.ts`.
 * Es braucht keine Datenbank.
 */

import { FeldTyp, PersonFeld, Teilnahmeform } from "@prisma/client";
import {
  bereinigeEntwurf,
  FeldEingabe,
  geheimeFeldcodes,
  ohneGeheimeAntworten,
  istIbanGueltig,
  pruefeAntworten,
  pruefeFelddefinition,
  pruefeVeroeffentlichung,
} from "../src/lib/formular";

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

/**
 * ACHTUNG beim Erweitern: Der Feldschluessel muss mindestens ZWEI Zeichen haben.
 * Ein einzeichiger Schluessel ("a") verletzt bereits die Format-Regel und
 * erzeugt einen Fehler — eine Pruefung, die dann nur `.length > 0` abfragt,
 * besteht unabhaengig davon, ob die eigentlich gemeinte Regel greift. Genau so
 * waren vier dieser Pruefungen vor dem Review wirkungslos.
 * Deshalb gilt hier durchgaengig: auf die MELDUNG pruefen, nicht auf die Anzahl.
 */
function feld(teil: Partial<FeldEingabe> & { code: string; typ: FeldTyp }): FeldEingabe {
  return {
    label: teil.code,
    pflicht: false,
    reihenfolge: 0,
    optionen: null,
    personFeld: PersonFeld.NICHTS,
    istArt9: false,
    ...teil,
  };
}

console.log("\n1. IBAN-Prüfsumme");
pruefe("gültige deutsche IBAN wird angenommen", istIbanGueltig("DE89 3704 0044 0532 0130 00"));
pruefe("Zahlendreher wird erkannt", !istIbanGueltig("DE89 3704 0044 0532 0130 09"));
pruefe("falsche Länge für DE wird erkannt", !istIbanGueltig("DE89370400440532013"));
pruefe("gültige österreichische IBAN wird angenommen", istIbanGueltig("AT61 1904 3002 3457 3201"));
pruefe("Buchstabensalat wird abgelehnt", !istIbanGueltig("HALLOWELT"));

console.log("\n2. Felddefinition");
pruefe(
  "doppelter Feldschlüssel wird erkannt",
  pruefeFelddefinition([feld({ code: "feld_a", typ: FeldTyp.TEXT }), feld({ code: "feld_a", typ: FeldTyp.TEXT })]).some(
    (f) => f.meldung.includes("mehrfach"),
  ),
);
pruefe(
  "zwei Felder auf dasselbe Aktenfeld werden erkannt",
  pruefeFelddefinition([
    feld({ code: "a", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME }),
    feld({ code: "b", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME }),
  ]).some((f) => f.meldung.includes("bereits")),
);
pruefe(
  "Auswahlfeld mit nur einer Option wird erkannt",
  pruefeFelddefinition([feld({ code: "auswahl", typ: FeldTyp.AUSWAHL_EINFACH, optionen: ["nur eine"] })]).some((f) =>
    f.meldung.includes("mindestens zwei"),
  ),
);
pruefe(
  "Typ passt nicht zum Aktenfeld (Text auf Geburtsdatum)",
  pruefeFelddefinition([feld({ code: "geburtstag", typ: FeldTyp.TEXT, personFeld: PersonFeld.GEBURTSDATUM })]).some((f) =>
    f.meldung.includes("Feldtyp passt nicht"),
  ),
);
pruefe(
  "Postleitzahl darf kein Zahlenfeld sein (führende Null ginge verloren)",
  pruefeFelddefinition([feld({ code: "plz", typ: FeldTyp.ZAHL, personFeld: PersonFeld.PLZ })]).some((f) =>
    f.meldung.includes("Feldtyp passt nicht"),
  ),
);
pruefe(
  "Teilnahmeform ohne ausdrückliche Zuordnung wird abgewiesen",
  pruefeFelddefinition([
    feld({
      code: "teilnahmeform",
      typ: FeldTyp.AUSWAHL_EINFACH,
      personFeld: PersonFeld.TEILNAHMEFORM,
      optionen: ["Mit Prüfung", "Ohne Prüfung"],
    }),
  ]).some((f) => f.meldung.includes("Schüler oder Hörer")),
);
pruefe(
  "Hinweistext darf kein Pflichtfeld sein",
  pruefeFelddefinition([feld({ code: "hinweis", typ: FeldTyp.HINWEIS, pflicht: true })]).some((f) =>
    f.meldung.includes("Pflichtfeld"),
  ),
);
pruefe(
  "Großbuchstaben im Feldschlüssel werden abgelehnt",
  pruefeFelddefinition([feld({ code: "Vorname", typ: FeldTyp.TEXT })]).length > 0,
);
pruefe(
  "sauberes Formular meldet keine Fehler",
  pruefeFelddefinition([
    feld({ code: "vorname", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME }),
    feld({ code: "email", typ: FeldTyp.EMAIL, personFeld: PersonFeld.EMAIL }),
  ]).length === 0,
);

console.log("\n3. Veröffentlichungsreife");
pruefe(
  "ohne E-Mail-Feld nicht veröffentlichbar",
  pruefeVeroeffentlichung([
    feld({ code: "vorname", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME, pflicht: true }),
    feld({ code: "nachname", typ: FeldTyp.TEXT, personFeld: PersonFeld.NACHNAME, pflicht: true }),
  ]).some((m) => m.includes("E-Mail")),
);
pruefe(
  "E-Mail-Feld muss Pflichtfeld sein",
  pruefeVeroeffentlichung([
    feld({ code: "vorname", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME, pflicht: true }),
    feld({ code: "nachname", typ: FeldTyp.TEXT, personFeld: PersonFeld.NACHNAME, pflicht: true }),
    feld({ code: "email", typ: FeldTyp.EMAIL, personFeld: PersonFeld.EMAIL, pflicht: false, label: "E-Mail" }),
  ]).some((m) => m.includes("Pflichtfeld")),
);
pruefe(
  "vollständiges Formular ist veröffentlichungsreif",
  pruefeVeroeffentlichung([
    feld({ code: "vorname", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME, pflicht: true }),
    feld({ code: "nachname", typ: FeldTyp.TEXT, personFeld: PersonFeld.NACHNAME, pflicht: true }),
    feld({ code: "email", typ: FeldTyp.EMAIL, personFeld: PersonFeld.EMAIL, pflicht: true }),
  ]).length === 0,
);

console.log("\n4. Antwortprüfung");
const formular: FeldEingabe[] = [
  feld({ code: "vorname", typ: FeldTyp.TEXT, personFeld: PersonFeld.VORNAME, pflicht: true }),
  feld({ code: "email", typ: FeldTyp.EMAIL, personFeld: PersonFeld.EMAIL, pflicht: true }),
  feld({ code: "geburtsdatum", typ: FeldTyp.DATUM, personFeld: PersonFeld.GEBURTSDATUM }),
  feld({ code: "iban", typ: FeldTyp.IBAN, personFeld: PersonFeld.IBAN }),
  feld({
    code: "teilnahmeform",
    typ: FeldTyp.AUSWAHL_EINFACH,
    personFeld: PersonFeld.TEILNAHMEFORM,
    optionen: ["Gast-Schüler mit Prüfung", "Nur zuhören"],
    // Genau dieser Fall lag mit der alten Rate-Heuristik falsch: „Gast-Schüler
    // mit Prüfung" enthält „gast" und ergab damit HOERER.
    teilnahmeformZuordnung: {
      "Gast-Schüler mit Prüfung": Teilnahmeform.SCHUELER,
      "Nur zuhören": Teilnahmeform.HOERER,
    },
  }),
  feld({ code: "gemeinde", typ: FeldTyp.TEXT, personFeld: PersonFeld.GEMEINDE, istArt9: true }),
  feld({ code: "hinweis", typ: FeldTyp.HINWEIS }),
];

const fehlendesPflichtfeld = pruefeAntworten(formular, { email: "a@b.de" }, true);
pruefe("fehlendes Pflichtfeld wird abgewiesen", !fehlendesPflichtfeld.ok);

const schlechteEmail = pruefeAntworten(formular, { vorname: "Peter", email: "keine-adresse" }, true);
pruefe("ungültige E-Mail wird abgewiesen", !schlechteEmail.ok);

const unmoeglichesDatum = pruefeAntworten(
  formular,
  { vorname: "Peter", email: "a@b.de", geburtsdatum: "2026-02-31" },
  true,
);
pruefe("31. Februar wird abgewiesen", !unmoeglichesDatum.ok);

const fremdeOption = pruefeAntworten(
  formular,
  { vorname: "Peter", email: "a@b.de", teilnahmeform: "Als Direktor" },
  true,
);
pruefe("nicht angebotene Auswahl wird abgewiesen", !fremdeOption.ok);

const gut = pruefeAntworten(
  formular,
  {
    vorname: "  Peter  ",
    email: "Peter@Beispiel.DE",
    geburtsdatum: "1980-05-04",
    iban: "de89 3704 0044 0532 0130 00",
    teilnahmeform: "Gast-Schüler mit Prüfung",
    gemeinde: "FeG Minden",
  },
  true,
);
pruefe("gültige Eingabe wird angenommen", gut.ok, gut.ok ? undefined : gut);
if (gut.ok) {
  pruefe("Leerzeichen werden entfernt", gut.personDaten.vorname === "Peter", gut.personDaten.vorname);
  pruefe("E-Mail wird kleingeschrieben", gut.personDaten.email === "peter@beispiel.de");
  pruefe("IBAN wird normalisiert", gut.personDaten.iban === "DE89370400440532013000");
  pruefe(
    "„Gast-Schüler mit Prüfung“ wird als Schüler erkannt (mit Raten war es Hörer)",
    gut.personDaten.teilnahmeform === Teilnahmeform.SCHUELER,
    gut.personDaten.teilnahmeform,
  );
  pruefe(
    "Geburtsdatum landet in der Akte",
    gut.personDaten.geburtsdatum?.toISOString().startsWith("1980-05-04") === true,
  );
  pruefe("Hinweistext erzeugt keine Antwort", !("hinweis" in gut.werte));
}

console.log("\n5. Art.-9-Sperre — der wichtigste Fall");
const ohneEinwilligung = pruefeAntworten(
  formular,
  { vorname: "Peter", email: "a@b.de", gemeinde: "FeG Minden" },
  false,
);
pruefe("ohne Art.-9-Einwilligung wird die Angabe verworfen", ohneEinwilligung.ok && ohneEinwilligung.werte.gemeinde === null);
pruefe(
  "ohne Art.-9-Einwilligung landet nichts in der Akte",
  ohneEinwilligung.ok && ohneEinwilligung.personDaten.gemeinde === undefined,
);

const mitEinwilligung = pruefeAntworten(
  formular,
  { vorname: "Peter", email: "a@b.de", gemeinde: "FeG Minden" },
  true,
);
pruefe("mit Einwilligung wird die Angabe übernommen", mitEinwilligung.ok && mitEinwilligung.werte.gemeinde === "FeG Minden");

console.log("\n6. IBAN steht nicht im Antwort-JSON — sie gehört verschlüsselt an die Person");
const mitIban = pruefeAntworten(
  formular,
  { vorname: "Peter", email: "a@b.de", iban: "DE89 3704 0044 0532 0130 00" },
  true,
);
// Ohne diese Zeile hing der ganze Abschnitt an einem ungeprueften `if`: Wird
// `pruefeAntworten` strenger — etwa weil ein neues Pflichtfeld dazukommt —,
// waere `mitIban.ok` falsch, und die vier Pruefungen darunter liefen einfach
// nicht mehr. Darunter „IBAN fehlt im gespeicherten Antwortobjekt", also die
// wichtigste des Abschnitts. Der Lauf haette weiterhin „0 fehlgeschlagen"
// gemeldet.
pruefe("Eingabe mit IBAN wird angenommen", mitIban.ok, mitIban.ok ? undefined : mitIban);
if (mitIban.ok) {
  const geheim = geheimeFeldcodes(formular);
  pruefe("IBAN-Feld wird als geheim erkannt", geheim.has("iban"));
  const gefiltert = ohneGeheimeAntworten(mitIban.werte, geheim);
  pruefe("IBAN fehlt im gespeicherten Antwortobjekt", !("iban" in gefiltert));
  pruefe("IBAN steht trotzdem für die Akte bereit", mitIban.personDaten.iban === "DE89370400440532013000");
  pruefe("andere Antworten bleiben erhalten", gefiltert.vorname === "Peter");
}

console.log("\n7. Entwurf speichert weder Art.-9-Angaben noch die IBAN");
const entwurf = bereinigeEntwurf(formular, {
  vorname: "Heimlich",
  gemeinde: "FeG Minden",
  iban: "DE89 3704 0044 0532 0130 00",
  unbekanntes_feld: "Fremddaten",
});
pruefe("normale Antwort wird übernommen", entwurf.vorname === "Heimlich");
pruefe("Art.-9-Angabe wird verworfen", !("gemeinde" in entwurf));
pruefe("IBAN wird verworfen", !("iban" in entwurf));
pruefe("unbekannter Schlüssel wird verworfen", !("unbekanntes_feld" in entwurf));

console.log("\n8. Datums-Plausibilität");
const zuSpaet = pruefeAntworten(formular, { vorname: "P", email: "a@b.de", geburtsdatum: "2090-01-01" }, true);
pruefe("Geburtsjahr 2090 wird abgewiesen", !zuSpaet.ok);
const zuFrueh = pruefeAntworten(formular, { vorname: "P", email: "a@b.de", geburtsdatum: "1000-01-01" }, true);
pruefe("Geburtsjahr 1000 wird abgewiesen", !zuFrueh.ok);

// Soll-Anzahl. Dieses Skript hat zwei Abschnitte, die in einem `if (…ok)`
// stehen. Wird einer davon nicht mehr betreten, laufen bis zu zehn Pruefungen
// nicht — ohne diese Zeile faellt das niemandem auf, weil ein nicht gelaufener
// Test nun einmal nicht fehlschlaegt. Beim Ergaenzen einer Pruefung gehoert die
// Zahl mit angehoben.
const ERWARTET = 43;
// `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
// Zeile — `pruefe` zaehlt erst im Rumpf hoch. Deshalb hier ausdruecklich um eins
// vorgegriffen, damit sich die Pruefung selbst mitzaehlt.
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

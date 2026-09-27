/**
 * Gegenprobe für die Formular-Fachlogik.
 *
 * Kein Test-Framework, weil in Release 0.1 noch keines eingerichtet ist — das
 * Skript prüft dieselben Dinge und läuft mit `npx tsx scripts/pruefe-formularlogik.ts`.
 * Es braucht keine Datenbank.
 */

import { readFileSync } from "fs";
import { FeldTyp, PersonFeld, Teilnahmeform } from "@prisma/client";
import {
  alsBuilderAbschnitte,
  alsFeldEingaben,
  bereinigeEntwurf,
  FeldEingabe,
  geheimeFeldcodes,
  ohneGeheimeAntworten,
  istIbanGueltig,
  pruefeAntworten,
  pruefeFelddefinition,
  pruefeVeroeffentlichung,
} from "../src/lib/formular";
import {
  behalteVorhandeneZuordnungen,
  bereinigeOptionenUndZuordnung,
  normalisiereOptionen,
} from "../src/lib/formular-optionen";

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

console.log("\n9. Builder: Antwortmöglichkeiten und Teilnahmeform-Zuordnung");
// Rohtext wie aus der Textarea: Rand-Leerzeichen, eine Leerzeile, ein Enter am
// Ende. Die Leerzeichen innerhalb der Antwort muessen stehen bleiben — genau
// die gingen verloren, solange bei jedem Tastendruck normalisiert wurde.
const optionenRoh = "  Ja, gemeinsam mit meinem Ehepartner \n\n Nein\n";
pruefe(
  "Antwortmöglichkeiten: Ränder getrimmt, leere Zeilen weg, Leerzeichen im Text bleiben",
  JSON.stringify(normalisiereOptionen(optionenRoh)) === JSON.stringify(["Ja, gemeinsam mit meinem Ehepartner", "Nein"]),
  normalisiereOptionen(optionenRoh),
);

const beschnitten = behalteVorhandeneZuordnungen(
  {
    "Als Schüler": Teilnahmeform.SCHUELER,
    "Als Hörer": Teilnahmeform.HOERER,
    "Alter Antworttext": Teilnahmeform.SCHUELER,
  },
  ["Als Schüler", "Als Hörer"],
);
pruefe(
  "Zuordnung einer umbenannten Antwort bleibt nicht verwaist stehen",
  beschnitten !== null && !("Alter Antworttext" in beschnitten),
  beschnitten,
);
pruefe(
  "Zuordnungen der vorhandenen Antworten bleiben erhalten",
  beschnitten?.["Als Schüler"] === Teilnahmeform.SCHUELER && beschnitten?.["Als Hörer"] === Teilnahmeform.HOERER,
  beschnitten,
);
// null statt {}: Die PUT-Route schreibt validierung nur bei einer Zuordnung,
// ein leeres Objekt landete als { teilnahmeform: {} } in der Datenbank.
pruefe(
  "bleibt keine Zuordnung übrig, kommt null zurück",
  behalteVorhandeneZuordnungen({ "Alter Antworttext": Teilnahmeform.HOERER }, ["Neu"]) === null,
);
// „— bitte wählen —" liefert "": Das ist keine Zuordnung. Bliebe es stehen,
// scheiterte das Speichern an der Zod-Pruefung mit einer allgemeinen Meldung
// statt mit dem Hinweis, fuer welche Antwort die Angabe fehlt.
pruefe(
  "„— bitte wählen —“ (leerer Wert) zählt nicht als Zuordnung",
  behalteVorhandeneZuordnungen({ "Als Hörer": "" }, ["Als Hörer"]) === null,
);
pruefe(
  "Antwort, die beim Normalisieren nur ihr Rand-Leerzeichen verliert, behält ihre Zuordnung",
  behalteVorhandeneZuordnungen({ "Als Hörer ": Teilnahmeform.HOERER }, ["Als Hörer"])?.["Als Hörer"] ===
    Teilnahmeform.HOERER,
);
pruefe(
  "ohne Aktenfeld Teilnahmeform wird keine Zuordnung mitgeschickt",
  bereinigeOptionenUndZuordnung(
    feld({
      code: "gemeinde",
      typ: FeldTyp.AUSWAHL_EINFACH,
      personFeld: PersonFeld.GEMEINDE,
      optionen: ["FeG Minden", "Andere"],
      teilnahmeformZuordnung: { "FeG Minden": Teilnahmeform.SCHUELER, Andere: Teilnahmeform.HOERER },
    }),
  ).teilnahmeformZuordnung === null,
);

// Rundweg wie im Builder: validierung so, wie die PUT-Route sie schreibt →
// alsFeldEingaben (so laedt die Builder-Seite) → bereinigeOptionenUndZuordnung
// (so sendet der Builder) → pruefeFelddefinition (so prueft die PUT-Route).
// Vorher fehlte die Zuordnung nach dem Laden, und jedes Speichern scheiterte,
// bis beide Antworten neu zugeordnet waren.
const geladen = alsFeldEingaben([
  {
    felder: [
      {
        code: "teilnahmeform",
        typ: FeldTyp.AUSWAHL_EINFACH,
        label: "Wie möchten Sie teilnehmen?",
        hilfetext: null,
        platzhalter: null,
        pflicht: true,
        reihenfolge: 0,
        optionen: ["Als Schüler — mit Prüfungen", "Als Hörer — ohne Prüfungen"],
        personFeld: PersonFeld.TEILNAHMEFORM,
        istArt9: false,
        validierung: {
          teilnahmeform: { "Als Schüler — mit Prüfungen": "SCHUELER", "Als Hörer — ohne Prüfungen": "HOERER" },
        },
      },
    ],
  },
]);
pruefe(
  "gespeicherte Zuordnung kommt beim Laden mit",
  geladen[0]?.teilnahmeformZuordnung?.["Als Hörer — ohne Prüfungen"] === Teilnahmeform.HOERER,
  geladen[0],
);
const erneutGespeichert = pruefeFelddefinition(geladen.map((f) => ({ ...f, ...bereinigeOptionenUndZuordnung(f) })));
pruefe("erneutes Speichern ohne Neuwahl besteht die Prüfung", erneutGespeichert.length === 0, erneutGespeichert);

/** Quelltext einer Datei, relativ zu gbs-campus/ (dort laeuft `npm run pruefen`). Fehlt sie: leer — die Pruefung wird rot. */
function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}

// Die Builder-Seite selbst: Der eigentliche M17-Fehler lag in ihrer eigenen
// Nachabbildung der Felder, nicht in alsFeldEingaben. Deshalb wird genau die
// Abbildung geprueft, die die Seite benutzt — und dass sie keine eigene hat.
const builderAbschnitte = alsBuilderAbschnitte([
  {
    titel: "Teilnahme",
    beschreibung: "Diese Frage stellt das Papierformular nicht.",
    felder: [
      {
        code: "teilnahmeform",
        typ: FeldTyp.AUSWAHL_EINFACH,
        label: "Wie möchten Sie teilnehmen?",
        hilfetext: null,
        platzhalter: null,
        pflicht: true,
        reihenfolge: 0,
        optionen: ["Als Schüler — mit Prüfungen", "Als Hörer — ohne Prüfungen"],
        personFeld: PersonFeld.TEILNAHMEFORM,
        istArt9: false,
        validierung: {
          teilnahmeform: { "Als Schüler — mit Prüfungen": "SCHUELER", "Als Hörer — ohne Prüfungen": "HOERER" },
        },
      },
    ],
  },
]);
pruefe(
  "Builder-Seite: Titel, Beschreibung und gespeicherte Zuordnung kommen im Builder an (alsBuilderAbschnitte)",
  builderAbschnitte[0]?.titel === "Teilnahme" &&
    builderAbschnitte[0]?.beschreibung === "Diese Frage stellt das Papierformular nicht." &&
    builderAbschnitte[0]?.felder[0]?.teilnahmeformZuordnung?.["Als Schüler — mit Prüfungen"] === Teilnahmeform.SCHUELER,
  builderAbschnitte,
);
const builderRundweg = pruefeFelddefinition(
  builderAbschnitte.flatMap((a) => a.felder).map((f, i) => ({ ...f, reihenfolge: i, ...bereinigeOptionenUndZuordnung(f) })),
);
pruefe(
  "Builder-Seite: Laden → unverändert Speichern besteht die Prüfung",
  builderRundweg.length === 0,
  builderRundweg,
);
const builderSeite = lies("src/app/verwaltung/formulare/[versionId]/page.tsx");
pruefe(
  "Builder-Seite bildet die Felder nicht selbst ab, sondern nutzt alsBuilderAbschnitte",
  /alsBuilderAbschnitte\(version\.abschnitte\)/.test(builderSeite) && !builderSeite.includes("alsFeldEingaben"),
);

// Der Server beschneidet selbst, statt dem Builder zu glauben: Andere Clients
// (curl, spaetere Oberflaechen) speicherten sonst verwaiste Zuordnungen. Und
// geprueft wie gespeichert wird dieselbe, bereinigte Liste — der Rohrumpf
// (`geprueft.data.abschnitte`) kommt genau einmal vor, beim Bereinigen.
const putRoute = lies("src/app/api/formulare/[versionId]/route.ts");
pruefe(
  "PUT /api/formulare/[versionId] bereinigt Antworten und Zuordnung selbst und speichert nur die bereinigte Fassung",
  /bereinigeOptionenUndZuordnung\(feld\)/.test(putRoute) && (putRoute.match(/geprueft\.data\.abschnitte/g) ?? []).length === 1,
);
const veroeffentlichenRoute = lies("src/app/api/formulare/[versionId]/veroeffentlichen/route.ts");
pruefe(
  "Veröffentlichen prüft die Felddefinition noch einmal (auch ungespeicherte Kopien)",
  /pruefeFelddefinition\(felder\)/.test(veroeffentlichenRoute),
);

console.log("\n10. Art. 9 ist für das Aktenfeld Gemeinde nicht abwählbar");
pruefe(
  "Aktenfeld Gemeinde ohne Art.-9-Kennzeichnung wird abgewiesen",
  pruefeFelddefinition([feld({ code: "gemeinde", typ: FeldTyp.TEXT, personFeld: PersonFeld.GEMEINDE, istArt9: false })]).some(
    (f) => f.meldung.includes("Art. 9"),
  ),
);
pruefe(
  "Aktenfeld Gemeinde mit Art.-9-Kennzeichnung ist in Ordnung",
  pruefeFelddefinition([feld({ code: "gemeinde", typ: FeldTyp.TEXT, personFeld: PersonFeld.GEMEINDE, istArt9: true })])
    .length === 0,
);

// Zur Laufzeit gilt die Regel auch für eine Fassung, die VOR ihr mit
// abgewähltem Häkchen veröffentlicht wurde (giltAlsArt9).
const alteGemeinde = feld({ code: "gemeinde", typ: FeldTyp.TEXT, personFeld: PersonFeld.GEMEINDE, istArt9: false });
const alteFassung = pruefeAntworten([alteGemeinde], { gemeinde: "Gemeinde am Ort" }, false);
pruefe(
  "Laufzeit: Gemeinde aus einer alten Fassung ohne Häkchen wird ohne Einwilligung verworfen (nicht in Antwort, nicht in Akte)",
  alteFassung.ok && alteFassung.werte.gemeinde === null && alteFassung.personDaten.gemeinde === undefined,
  alteFassung,
);
pruefe(
  "Laufzeit: … und nicht zwischengespeichert",
  !("gemeinde" in bereinigeEntwurf([alteGemeinde], { gemeinde: "Gemeinde am Ort" })),
);
pruefe(
  "Anmeldeseite blendet die Gemeinde auch ohne Häkchen wie ein Art.-9-Feld ein und aus",
  /istArt9: feld\.istArt9 \|\| aktenfeldVerlangtArt9\(feld\.personFeld\)/.test(lies("src/app/anmeldung/page.tsx")) &&
    !/aktenfeldVerlangtArt9/.test(lies("src/lib/formular.ts").slice(lies("src/lib/formular.ts").indexOf("export function alsFeldEingaben"))),
);

console.log("\n11. Teilnahmeform-Zuordnung: nur eigene Einträge zählen");
// Mit einem schlichten `zuordnung[antwort]` fand „constructor" die geerbte
// Methode von Object.prototype und galt als zugeordnet.
const prototypFeld = feld({
  code: "teilnahmeform",
  typ: FeldTyp.AUSWAHL_EINFACH,
  personFeld: PersonFeld.TEILNAHMEFORM,
  optionen: ["constructor", "toString", "Als Hörer"],
  teilnahmeformZuordnung: { "Als Hörer": Teilnahmeform.HOERER },
});
pruefe(
  "Antworten „constructor“ und „toString“ ohne Zuordnung werden gemeldet",
  pruefeFelddefinition([prototypFeld]).some((f) => f.meldung.includes("constructor") && f.meldung.includes("toString")),
  pruefeFelddefinition([prototypFeld]),
);
const prototypAntwort = pruefeAntworten([prototypFeld], { teilnahmeform: "toString" }, true);
pruefe(
  "Antwort „toString“ setzt keine Teilnahmeform (keine geerbte Funktion in der Akte)",
  prototypAntwort.ok && prototypAntwort.personDaten.teilnahmeform === undefined,
  prototypAntwort.ok ? typeof prototypAntwort.personDaten.teilnahmeform : prototypAntwort,
);
pruefe(
  "Builder liest die Zuordnung nur aus eigenen Einträgen (Object.hasOwn), kein geerbtes „toString“ im <select>",
  /Object\.hasOwn\(feld\.teilnahmeformZuordnung, option\)/.test(lies("src/app/verwaltung/formulare/formular-builder.tsx")) &&
    !/feld\.teilnahmeformZuordnung\?\.\[option\]/.test(lies("src/app/verwaltung/formulare/formular-builder.tsx")),
);

// Soll-Anzahl. Dieses Skript hat zwei Abschnitte, die in einem `if (…ok)`
// stehen. Wird einer davon nicht mehr betreten, laufen bis zu zehn Pruefungen
// nicht — ohne diese Zeile faellt das niemandem auf, weil ein nicht gelaufener
// Test nun einmal nicht fehlschlaegt. Beim Ergaenzen einer Pruefung gehoert die
// Zahl mit angehoben.
const ERWARTET = 65;
// `geprueft` steht beim Auswerten der Bedingung noch auf dem Stand VOR dieser
// Zeile — `pruefe` zaehlt erst im Rumpf hoch. Deshalb hier ausdruecklich um eins
// vorgegriffen, damit sich die Pruefung selbst mitzaehlt.
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

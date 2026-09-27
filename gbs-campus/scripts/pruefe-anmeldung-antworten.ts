/**
 * Gegenprobe für die Anmeldeantworten: Antwortansicht der Verwaltung
 * (Art.-9-Schutz, IBAN nie im Klartext, Einwilligungsstand) und die Meldungen
 * zum Zwischenstand im öffentlichen Formular.
 *
 * Ohne Datenbank, ohne Test-Framework — dieselbe Bauart wie die übrigen
 * `pruefe-*.ts`. Geprüft werden die reinen Funktionen aus
 * `src/lib/anmeldung-antworten.ts`, und zwar auch GEGEN die Regeln aus
 * `src/lib/formular.ts` (bereinigeEntwurf, geheimeFeldcodes): Die Meldung
 * „nicht gespeichert werden …" darf nie etwas anderes behaupten, als der
 * Speicherpfad tatsächlich tut.
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Regel auskommentieren, Skript
 * laufen lassen — bleibt es grün, prüft die neue Zeile nicht, was sie behauptet.
 */

import { readFileSync } from "fs";
import { FeldTyp, PersonFeld } from "@prisma/client";
import {
  art9Eingewilligt,
  art9EinwilligungenWirksam,
  art9Freigabe,
  baueAntwortAnsicht,
  beschreibeNichtImZwischenstand,
  einwilligungWirksam,
  hatEingabe,
  hatUngesicherteEingaben,
  istIbanFeld,
  nichtImZwischenstand,
  type AnsichtAbschnitt,
  type AnsichtFeld,
  type AnsichtZeile,
} from "../src/lib/anmeldung-antworten";
import { bereinigeEntwurf, geheimeFeldcodes, type FeldEingabe } from "../src/lib/formular";
import { ABSCHNITTE } from "../prisma/anmeldeformular-definition";
import { anmeldestatusName } from "../src/lib/anmeldestatus";
import { anmeldungsstatusText } from "../src/lib/auskunft-inhalt";

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

const f = (code: string, label: string, typ: string, istArt9 = false, personFeld = "NICHTS"): AnsichtFeld => ({
  code,
  label,
  typ,
  istArt9,
  personFeld,
});

// Ein Formular mit allen Sonderfällen: Hinweisfelder, reine Art.-9-Abschnitte,
// ein gemischter Abschnitt, eine IBAN nach Feldtyp und eine nur nach
// Aktenzuordnung.
const FORMULAR: AnsichtAbschnitt[] = [
  {
    titel: "Persönliche Daten",
    felder: [
      f("vorname", "Vorname", "TEXT", false, "VORNAME"),
      f("hinweis", "Bitte vollständig ausfüllen", "HINWEIS"),
      f("beruf", "Beruf", "TEXT"),
    ],
  },
  // Ein Hinweisfeld macht einen Art.-9-Abschnitt nicht zum gemischten.
  {
    titel: "Persönlich-Geistlicher Werdegang",
    felder: [
      f("glaube_hinweis", "Diese Angaben brauchen wir für die Aufnahme.", "HINWEIS"),
      f("glaube", "Wie kamen Sie zum Glauben?", "MEHRZEILIG", true),
    ],
  },
  {
    titel: "Bewerbungshintergrund",
    felder: [
      f("gemeinde", "Gemeinde", "TEXT", true, "GEMEINDE"),
      f("motivation", "Motivation", "MEHRZEILIG", true),
    ],
  },
  { titel: "Sonstiges", felder: [f("hobby", "Hobby", "TEXT"), f("dienst", "Dienst in der Gemeinde?", "JA_NEIN", true)] },
  {
    titel: "Bankverbindung",
    felder: [
      f("beitrag", "Der Beitrag wird eingezogen.", "HINWEIS"),
      f("iban", "IBAN", "IBAN", false, "IBAN"),
      f("iban_text", "IBAN (als Textfeld)", "TEXT", false, "IBAN"),
      f("zahlweise", "Zahlweise", "AUSWAHL_EINFACH"),
    ],
  },
];

// Absichtlich MIT IBAN im Klartext: So sahen Anmeldungen vor dem Review aus —
// auch dann darf die Ansicht sie nicht zeigen.
const ANTWORTEN: Record<string, unknown> = {
  vorname: "Petra",
  hinweis: "darf nicht erscheinen",
  glaube: "Bekehrung 2019",
  gemeinde: "FeG Minden",
  motivation: "Bibel verstehen",
  hobby: "Chor",
  dienst: true,
  iban: "DE89370400440532013000",
  iban_text: "DE12500105170648489890",
  zahlweise: "Halbjährlich",
  altfeld: "Geheimnis aus alter Fassung",
};

const zeile = (bloecke: { zeilen: AnsichtZeile[] }[], code: string): AnsichtZeile | undefined =>
  bloecke.flatMap((b) => b.zeilen).find((z) => z.code === code);
const wertVon = (z: AnsichtZeile | undefined): string | undefined => (z && z.art === "wert" ? z.wert : undefined);

// ---------------------------------------------------------------------------
console.log("\n1. Einwilligungsstand (append-only: die jüngste Zeile gilt)");
const t = (minuten: number) => new Date(Date.UTC(2026, 8, 1, 10, minuten));
pruefe("ohne Einträge keine Einwilligung", einwilligungWirksam([]) === false);
pruefe("nur erteilt → wirksam", einwilligungWirksam([{ erteilt: true, zeitpunkt: t(0) }]) === true);
pruefe("nur verweigert → nicht wirksam", einwilligungWirksam([{ erteilt: false, zeitpunkt: t(0) }]) === false);
pruefe(
  "erteilt, später widerrufen → nicht wirksam",
  einwilligungWirksam([
    { erteilt: true, zeitpunkt: t(0) },
    { erteilt: false, zeitpunkt: t(5) },
  ]) === false,
);
pruefe(
  "verweigert, später erteilt → wirksam",
  einwilligungWirksam([
    { erteilt: false, zeitpunkt: t(0) },
    { erteilt: true, zeitpunkt: t(5) },
  ]) === true,
);
pruefe(
  "die Reihenfolge der Zeilen entscheidet nichts, nur der Zeitpunkt",
  einwilligungWirksam([
    { erteilt: true, zeitpunkt: t(5) },
    { erteilt: false, zeitpunkt: t(0) },
  ]) === true,
);
pruefe(
  "Gleichstand von Erteilung und Verweigerung → im Zweifel nicht wirksam",
  einwilligungWirksam([
    { erteilt: true, zeitpunkt: t(3) },
    { erteilt: false, zeitpunkt: t(3) },
  ]) === false,
);

// ---------------------------------------------------------------------------
console.log("\n2. Art.-9-Freigabe");
pruefe("ohne Entscheidungsrecht: ausgeblendet trotz Einwilligung", art9Freigabe(false, true) === "KEIN_RECHT");
pruefe("ohne Recht und ohne Einwilligung: zuerst das fehlende Recht", art9Freigabe(false, false) === "KEIN_RECHT");
pruefe("mit Recht, ohne Einwilligung: ausgeblendet", art9Freigabe(true, false) === "KEINE_EINWILLIGUNG");
pruefe("mit Recht und Einwilligung: sichtbar", art9Freigabe(true, true) === "SICHTBAR");

// Beim Absenden: dieselbe Regel für Formular (Freischalten) und Server (Speichern).
const TEXTE = [
  { code: "DATENSCHUTZ", istArt9: false },
  { code: "GLAUBENSANGABEN", istArt9: true },
];
pruefe(
  "Absenden: ohne angebotenen Art.-9-Text ist nichts erteilt — auch wenn der Code mitgeschickt wird",
  art9Eingewilligt([{ code: "DATENSCHUTZ", istArt9: false }], new Set(["DATENSCHUTZ", "GLAUBENSANGABEN"])) === false,
);
pruefe(
  "Absenden: der Art.-9-Text ist erteilt → Art. 9 erteilt (andere Texte spielen keine Rolle)",
  art9Eingewilligt(TEXTE, new Set(["GLAUBENSANGABEN"])) === true,
);
pruefe("Absenden: Art.-9-Text nicht erteilt → nicht erteilt", art9Eingewilligt(TEXTE, new Set(["DATENSCHUTZ"])) === false);
pruefe(
  "Absenden: zwei Art.-9-Texte, nur einer erteilt → nicht erteilt (wie das Formular)",
  art9Eingewilligt([...TEXTE, { code: "GESUNDHEIT", istArt9: true }], new Set(["DATENSCHUTZ", "GLAUBENSANGABEN"])) === false,
);

// Anzeige und Ausbildungsdaten: je Art.-9-Text die jüngste Zeile, alle wirksam.
pruefe("Anzeige: ohne Art.-9-Zeilen keine Einwilligung", art9EinwilligungenWirksam([]) === false);
pruefe(
  "Anzeige: zwei Art.-9-Texte, beide erteilt → wirksam",
  art9EinwilligungenWirksam([
    { code: "GLAUBENSANGABEN", erteilt: true, zeitpunkt: t(0) },
    { code: "GESUNDHEIT", erteilt: true, zeitpunkt: t(1) },
  ]) === true,
);
pruefe(
  "Anzeige: zwei Art.-9-Texte, nur der zweite widerrufen → nicht wirksam (nicht allein nach GLAUBENSANGABEN)",
  art9EinwilligungenWirksam([
    { code: "GLAUBENSANGABEN", erteilt: true, zeitpunkt: t(0) },
    { code: "GESUNDHEIT", erteilt: true, zeitpunkt: t(1) },
    { code: "GESUNDHEIT", erteilt: false, zeitpunkt: t(9) },
  ]) === false,
);
{
  const lesen = (pfad: string) => {
    try {
      return readFileSync(pfad, "utf8");
    } catch {
      return "";
    }
  };
  const stellen = [
    "src/app/verwaltung/anmeldungen/[id]/page.tsx",
    "src/app/verwaltung/personen/[id]/page.tsx",
    "src/app/api/personen/[id]/ausbildungsdaten/route.ts",
  ].filter((pfad) => {
    const text = lesen(pfad);
    return !(/text: \{ istArt9: true \}/.test(text) && /art9EinwilligungenWirksam\(/.test(text) && !/EINWILLIGUNG\.GLAUBENSANGABEN/.test(text));
  });
  pruefe("Anzeige, Akte und Ausbildungsdaten prüfen alle Art.-9-Texte (nicht nur GLAUBENSANGABEN)", stellen.length === 0, stellen);
}

// ---------------------------------------------------------------------------
console.log("\n3. Antwortansicht der Verwaltung");
const verborgen = baueAntwortAnsicht(FORMULAR, ANTWORTEN, false);
const offen = baueAntwortAnsicht(FORMULAR, ANTWORTEN, true);
const verborgenJson = JSON.stringify(verborgen);
const offenJson = JSON.stringify(offen);

pruefe(
  "Abschnitte in Formular-Reihenfolge mit ihren damaligen Titeln",
  JSON.stringify(verborgen.abschnitte.map((b) => b.titel)) ===
    JSON.stringify(["Persönliche Daten", "Persönlich-Geistlicher Werdegang", "Bewerbungshintergrund", "Sonstiges", "Bankverbindung"]),
  verborgen.abschnitte.map((b) => b.titel),
);
pruefe("Antwort erscheint mit Label", wertVon(zeile(verborgen.abschnitte, "vorname")) === "Petra");
pruefe(
  "nicht in die Akte übernommene Antwort (Zahlweise) ist lesbar",
  wertVon(zeile(verborgen.abschnitte, "zahlweise")) === "Halbjährlich",
);
pruefe(
  "Hinweisfelder erscheinen nicht",
  !zeile(offen.abschnitte, "hinweis") && !zeile(offen.abschnitte, "beitrag") && !offenJson.includes("darf nicht erscheinen"),
);
pruefe("unbeantwortete Frage erscheint mit „—“", wertVon(zeile(verborgen.abschnitte, "beruf")) === "—");
pruefe("Art.-9-Frage ohne Freigabe: als ausgeblendet markiert", zeile(verborgen.abschnitte, "glaube")?.art === "art9_verborgen");
pruefe(
  "Art.-9-Inhalte stehen ohne Freigabe NIRGENDS in der Ansicht",
  !["Bekehrung", "FeG Minden", "Bibel verstehen"].some((s) => verborgenJson.includes(s)),
  verborgenJson,
);
pruefe(
  "gemischter Abschnitt: Nicht-Art.-9-Antwort bleibt sichtbar, Art.-9-Antwort nicht",
  wertVon(zeile(verborgen.abschnitte, "hobby")) === "Chor" && zeile(verborgen.abschnitte, "dienst")?.art === "art9_verborgen",
);
pruefe("mit Freigabe: Art.-9-Antwort lesbar", wertVon(zeile(offen.abschnitte, "glaube")) === "Bekehrung 2019");
pruefe("mit Freigabe: Ja/Nein wird lesbar formatiert", wertVon(zeile(offen.abschnitte, "dienst")) === "Ja");
pruefe(
  "IBAN nach Feldtyp: nie ein Wert — auch mit Freigabe",
  zeile(offen.abschnitte, "iban")?.art === "iban" && !offenJson.includes("DE89"),
  offenJson,
);
pruefe(
  "IBAN nur nach Aktenzuordnung (Textfeld): ebenfalls nie ein Wert",
  zeile(offen.abschnitte, "iban_text")?.art === "iban" && !offenJson.includes("DE12"),
  offenJson,
);
pruefe(
  "unbekannter Code ohne Freigabe: ausgeblendet, Inhalt nicht in der Ansicht",
  verborgen.weitere.some((z) => z.code === "altfeld" && z.art === "art9_verborgen") && !verborgenJson.includes("Geheimnis"),
  verborgen.weitere,
);
pruefe(
  "unbekannter Code mit Freigabe: mit rohem Code ausgewiesen",
  offen.weitere.some((z) => z.label === "(altfeld)" && z.art === "wert" && z.wert === "Geheimnis aus alter Fassung"),
  offen.weitere,
);

// ---------------------------------------------------------------------------
console.log("\n4. Zwischenstand: was „Später weitermachen“ nicht speichert");
const teile = nichtImZwischenstand(FORMULAR);
pruefe(
  "reine Art.-9-Abschnitte werden mit Titel genannt",
  JSON.stringify(teile.art9Abschnitte) === JSON.stringify(["Persönlich-Geistlicher Werdegang", "Bewerbungshintergrund"]),
  teile,
);
pruefe("gemischte Abschnitte stehen getrennt", JSON.stringify(teile.gemischteAbschnitte) === JSON.stringify(["Sonstiges"]), teile);
pruefe("die IBAN wird erkannt", teile.iban === true);
pruefe(
  "Satzteil im Nominativ",
  beschreibeNichtImZwischenstand(teile, "nominativ") ===
    "die Antworten in „Persönlich-Geistlicher Werdegang“ und „Bewerbungshintergrund“, " +
      "die Angaben zu Glaube und Gemeinde in „Sonstiges“ sowie die IBAN",
  beschreibeNichtImZwischenstand(teile, "nominativ"),
);
pruefe(
  "Satzteil im Dativ („außer …“)",
  beschreibeNichtImZwischenstand(teile, "dativ") ===
    "den Antworten in „Persönlich-Geistlicher Werdegang“ und „Bewerbungshintergrund“, " +
      "den Angaben zu Glaube und Gemeinde in „Sonstiges“ sowie der IBAN",
  beschreibeNichtImZwischenstand(teile, "dativ"),
);
const nurIban = nichtImZwischenstand([{ titel: "Bank", felder: [f("vorname", "Vorname", "TEXT"), f("iban", "IBAN", "IBAN")] }]);
pruefe(
  "nur eine IBAN: „die IBAN“ / „der IBAN“",
  beschreibeNichtImZwischenstand(nurIban, "nominativ") === "die IBAN" &&
    beschreibeNichtImZwischenstand(nurIban, "dativ") === "der IBAN",
);
pruefe(
  "Formular ohne Art.-9-Felder und ohne IBAN: keine Meldung",
  beschreibeNichtImZwischenstand(nichtImZwischenstand([{ titel: "A", felder: [f("vorname", "Vorname", "TEXT")] }]), "nominativ") ===
    null,
);
pruefe(
  "drei Abschnitte werden mit Komma und „und“ aufgezählt",
  beschreibeNichtImZwischenstand(
    nichtImZwischenstand([
      { titel: "A", felder: [f("a1", "A", "TEXT", true)] },
      { titel: "B", felder: [f("b1", "B", "TEXT", true)] },
      { titel: "C", felder: [f("c1", "C", "TEXT", true)] },
    ]),
    "nominativ",
  ) === "die Antworten in „A“, „B“ und „C“",
);

// Das Standardformular aus dem Seed — genau der Fall aus dem Review: Motivation
// und Ziele stehen im „Bewerbungshintergrund", und die IBAN fehlte in der Meldung.
const standard = nichtImZwischenstand(
  ABSCHNITTE.map((a) => ({
    titel: a.titel,
    felder: a.felder.map((feld) => ({
      code: feld.code,
      typ: feld.typ,
      label: feld.label,
      istArt9: feld.istArt9 ?? false,
      personFeld: feld.personFeld ?? "NICHTS",
    })),
  })),
);
pruefe(
  "Standardformular: die Meldung nennt beide Freitext-Abschnitte und die IBAN",
  beschreibeNichtImZwischenstand(standard, "nominativ") ===
    "die Antworten in „Persönlich-Geistlicher Werdegang“ und „Bewerbungshintergrund“ sowie die IBAN",
  beschreibeNichtImZwischenstand(standard, "nominativ"),
);

// Deckungsgleich mit dem Speicherpfad: Was die Meldung nennt, verwirft
// bereinigeEntwurf — und nichts sonst.
const alsFeldEingabe = (feld: AnsichtFeld, reihenfolge: number): FeldEingabe => ({
  code: feld.code,
  typ: feld.typ as FeldTyp,
  label: feld.label,
  pflicht: false,
  reihenfolge,
  optionen: null,
  personFeld: (feld.personFeld ?? "NICHTS") as PersonFeld,
  istArt9: feld.istArt9,
});
const eingaben = FORMULAR.flatMap((a) => a.felder).map(alsFeldEingabe);
const vollAusgefuellt = Object.fromEntries(eingaben.map((e) => [e.code, "x"]));
const behalten = bereinigeEntwurf(eingaben, vollAusgefuellt);
const verworfen = eingaben
  .filter((e) => e.typ !== FeldTyp.HINWEIS && !(e.code in behalten))
  .map((e) => e.code)
  .sort();
pruefe(
  "genannte Felder = von bereinigeEntwurf verworfene Felder",
  JSON.stringify([...teile.codes].sort()) === JSON.stringify(verworfen),
  { genannt: [...teile.codes].sort(), verworfen },
);
pruefe(
  "IBAN-Regel = geheimeFeldcodes aus lib/formular.ts",
  JSON.stringify(eingaben.filter((e) => istIbanFeld(e)).map((e) => e.code).sort()) ===
    JSON.stringify([...geheimeFeldcodes(eingaben)].sort()),
);

console.log("\n5. Warnung vor dem Zwischenspeichern");
pruefe(
  "leere Eingaben zählen nicht",
  !hatEingabe("") && !hatEingabe("   ") && !hatEingabe([]) && !hatEingabe(null) && !hatEingabe(undefined),
);
pruefe("„Nein“ (false), Text, Auswahl und 0 zählen als Eingabe", hatEingabe(false) && hatEingabe("a") && hatEingabe(["x"]) && hatEingabe(0));
pruefe(
  "nur gespeicherte Felder ausgefüllt: keine Warnung",
  hatUngesicherteEingaben(teile, { vorname: "Petra", hobby: "Chor", zahlweise: "Monatlich", motivation: "   " }) === false,
);
pruefe("Freitext in einem Art.-9-Feld: Warnung", hatUngesicherteEingaben(teile, { motivation: "Bibel verstehen" }) === true);
pruefe("eingetragene IBAN: Warnung", hatUngesicherteEingaben(teile, { iban: "DE89 3704" }) === true);

// ---------------------------------------------------------------------------
console.log("\n6. Öffentliche Schnittstelle (Quelltext)");
/** Quelltext relativ zu gbs-campus/ (dort läuft `npm run pruefen`). Fehlt die Datei: leer — die Prüfung wird rot. */
function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}
const seite = lies("src/app/anmeldung/page.tsx");
const formularQuelle = lies("src/app/anmeldung/oeffentliches-formular.tsx");
const route = lies("src/app/api/anmeldung/route.ts");
const anmeldungLib = lies("src/lib/anmeldung.ts");
// Der Token öffnet 14 Tage lang Kontaktdaten und Freitexte. Im Query-String
// stünde er in jedem Zugriffslog des Reverse Proxy — im Fragment nie.
pruefe(
  "Fortsetzen-Token nie im Query-String: die Seite liest keine searchParams, das Formular schreibt keinen",
  seite.length > 0 &&
    !seite.includes("searchParams") &&
    /hash = `fortsetzen=\$\{/.test(formularQuelle) &&
    !/searchParams\.set\(\s*"fortsetzen"/.test(formularQuelle) &&
    /aktion: z\.literal\("laden"\)/.test(route),
);
// Ein gefülltes Fangfeld endet vor nimmAnmeldungEntgegen: keine Akte, keine Mail.
const honeypotStelle = route.indexOf("hp_feld?.trim()");
const absendenStelle = route.indexOf("nimmAnmeldungEntgegen({");
pruefe(
  "Honeypot: gefülltes Fangfeld wird vor dem Anlegen mit neutraler Erfolgsantwort beendet",
  honeypotStelle > 0 &&
    absendenStelle > honeypotStelle &&
    /hp_feld[^\n]*\)\s*\{[\s\S]{0,600}?return erfolg\(\{ eingereicht: true \}\)/.test(route.slice(honeypotStelle, absendenStelle)),
);
pruefe(
  "Fortsetzen-Link in einem schon offenen Tab: hashchange lädt neu, wenn ein anderer Token im Fragment steht",
  /window\.addEventListener\("hashchange", fragmentGeaendert\)/.test(formularQuelle) &&
    /if \(neu && neu !== aktuellerToken\.current\) window\.location\.reload\(\);/.test(formularQuelle) &&
    /window\.removeEventListener\("hashchange", fragmentGeaendert\)/.test(formularQuelle) &&
    /aktuellerToken\.current = gefunden;/.test(formularQuelle),
);
pruefe(
  "Fangfeld ohne Autofill-Namen (hp_feld statt website) — sonst füllen Passwortmanager es und die Anmeldung verschwindet still",
  /id="hp_feld"/.test(formularQuelle) &&
    /hp_feld: hpFeld/.test(formularQuelle) &&
    /hp_feld: z\.string\(\)/.test(route) &&
    !/"website"|\bwebsite,|setWebsite/.test(formularQuelle) &&
    !/website: z\.|data\.website/.test(route),
);
pruefe(
  "Art.-9-Regel aus einer Quelle: Server und Formular nutzen art9Eingewilligt",
  /art9Eingewilligt\(texte, erteilt\)/.test(anmeldungLib) && /art9Eingewilligt\(einwilligungen, /.test(formularQuelle),
);

// ---------------------------------------------------------------------------
console.log("\n7. Anmeldestatus: ein Klartext für Liste, Einzelansicht und Auskunft");
pruefe(
  "ANGENOMMEN heißt überall „Angenommen“ (nicht „Aufgenommen“) — auch in der Datenauskunft",
  anmeldestatusName("ANGENOMMEN") === "Angenommen" && anmeldungsstatusText("ANGENOMMEN") === anmeldestatusName("ANGENOMMEN"),
  { verwaltung: anmeldestatusName("ANGENOMMEN"), auskunft: anmeldungsstatusText("ANGENOMMEN") },
);
pruefe(
  "ein unbekannter Status bleibt sichtbar statt leer",
  anmeldestatusName("UNBEKANNT") === "UNBEKANNT" && anmeldestatusName("EINGEREICHT") === "Wartet auf Entscheidung",
);
pruefe(
  "Liste und Einzelansicht nutzen den gemeinsamen Badge statt eigener Tabellen",
  ["src/app/verwaltung/anmeldungen/page.tsx", "src/app/verwaltung/anmeldungen/[id]/page.tsx"].every(
    (pfad) => /<AnmeldungStatusBadge status=\{anmeldung\.status\} \/>/.test(lies(pfad)) && !/Aufgenommen|STATUS_NAME/.test(lies(pfad)),
  ),
);

// ---------------------------------------------------------------------------
// Soll-Anzahl — beim Ergänzen einer Prüfung mit anheben. `geprueft` steht hier
// noch auf dem Stand VOR dieser Zeile, deshalb +1.
const ERWARTET = 58;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

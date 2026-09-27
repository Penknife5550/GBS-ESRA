/**
 * Gegenprobe für die Rollenverwaltung (DB-frei): der Diff zwischen Ist- und
 * Soll-Rollen, die Prüfung auf bekannte Rollen und die Erkennung eines
 * Administrator-Entzugs. Seit Code-Review 4 (M9) auch die Statusmaschine von
 * Hand und die Ausbildungsdaten (`src/lib/status.ts`) sowie — am Quelltext —
 * Seed-Schalter und Recht. Ab Abschnitt 9 die Rechte-Codes (Seed und RECHT
 * deckungsgleich, keine rohen Literale) und die Trennung 401/403 der API-Routen
 * (`pruefeZugriff`). Aufruf aus dem Anwendungsordner (relative Pfade).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt. Auf den konkreten Wert prüfen.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  ADMIN_ROLLE,
  entziehtAdmin,
  istNameGueltig,
  pruefeNeuePerson,
  rollenDiff,
  sindRollenBekannt,
  waereLetzterAdmin,
} from "../src/lib/benutzerverwaltung";
import {
  brauchtGrund,
  darfAusEndzustand,
  MELDUNG_ANMELDUNG_OFFEN,
  MELDUNG_WIEDERAUFNAHME_GRUND,
  pruefeAusbildungsdaten,
  pruefeStatuswechsel,
  waehlbareZiele,
} from "../src/lib/status";

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

const sortiert = (a: string[]) => [...a].sort().join(",");

console.log("\n1. Diff zwischen Ist und Soll");
{
  const d = rollenDiff(["TEILNEHMER", "DOZENT"], ["TEILNEHMER"]);
  pruefe("eine neue Rolle wird als hinzu erkannt", sortiert(d.hinzu) === "DOZENT" && d.weg.length === 0, d);
}
{
  const d = rollenDiff(["TEILNEHMER"], ["TEILNEHMER", "DOZENT"]);
  pruefe("eine entfernte Rolle wird als weg erkannt", sortiert(d.weg) === "DOZENT" && d.hinzu.length === 0, d);
}
{
  const d = rollenDiff(["TEILNEHMER", "DOZENT"], ["TEILNEHMER", "DOZENT"]);
  pruefe("unveränderte Rollen ergeben keinen Diff", d.hinzu.length === 0 && d.weg.length === 0, d);
}
{
  const d = rollenDiff(["ADMIN", "DOZENT"], ["TEILNEHMER"]);
  pruefe("gleichzeitig hinzu und weg", sortiert(d.hinzu) === "ADMIN,DOZENT" && sortiert(d.weg) === "TEILNEHMER", d);
}
{
  // Doppelte im Wunsch dürfen keinen Unterschied machen (Mengen).
  const d = rollenDiff(["DOZENT", "DOZENT"], ["DOZENT"]);
  pruefe("doppelte Wunsch-Rollen ergeben keinen Diff", d.hinzu.length === 0 && d.weg.length === 0, d);
}

console.log("\n2. Nur bekannte Rollen");
pruefe("bekannte Rollen sind zulässig", sindRollenBekannt(["TEILNEHMER", "DOZENT"], ["TEILNEHMER", "DOZENT", "ADMIN"]) === true);
pruefe("eine unbekannte Rolle wird abgelehnt", sindRollenBekannt(["TEILNEHMER", "HACKER"], ["TEILNEHMER", "DOZENT"]) === false);
pruefe("die leere Wunschmenge ist zulässig", sindRollenBekannt([], ["TEILNEHMER"]) === true);

console.log("\n3. Administrator-Entzug erkennen");
pruefe("ADMIN_ROLLE ist ADMIN (passend zum Seed)", ADMIN_ROLLE === "ADMIN");
pruefe("Entzug von ADMIN wird erkannt", entziehtAdmin(rollenDiff(["TEILNEHMER"], ["ADMIN", "TEILNEHMER"])) === true);
pruefe("ohne ADMIN-Entzug meldet es false", entziehtAdmin(rollenDiff(["ADMIN"], ["ADMIN", "DOZENT"])) === false);
pruefe("das Hinzufügen von ADMIN ist kein Entzug", entziehtAdmin(rollenDiff(["ADMIN"], [])) === false);
pruefe(
  "der letzte Administrator verliert den Zugang nicht (Endzustand, Anonymisierung)",
  waereLetzterAdmin({ istAdmin: true, verliertZugang: true, andereAdmins: 0 }) === true,
);
pruefe(
  "mit einem weiteren Administrator ist der Schritt erlaubt",
  waereLetzterAdmin({ istAdmin: true, verliertZugang: true, andereAdmins: 1 }) === false,
);
pruefe(
  "ohne Administratorrolle oder ohne Zugangsverlust greift die Wache nicht",
  waereLetzterAdmin({ istAdmin: false, verliertZugang: true, andereAdmins: 0 }) === false &&
    waereLetzterAdmin({ istAdmin: true, verliertZugang: false, andereAdmins: 0 }) === false,
);

console.log("\n4. Person anlegen: Eingabeprüfung");
pruefe("ein normaler Name ist gültig", istNameGueltig("Petra") === true);
pruefe("ein leerer Name ist ungültig", istNameGueltig("   ") === false);
pruefe("ein zu langer Name (81 Zeichen) ist ungültig", istNameGueltig("x".repeat(81)) === false);
{
  const e = pruefeNeuePerson({ vorname: "Dora", nachname: "Dozento", email: "Dora@Beispiel.DE", telefon: "0571 123" });
  pruefe("gültige Eingabe wird angenommen", e.ok === true, e);
  pruefe("die E-Mail wird kleingeschrieben normalisiert", e.ok && e.werte.email === "dora@beispiel.de", e);
}
pruefe("fehlender Vorname wird abgewiesen", pruefeNeuePerson({ nachname: "X", email: "a@b.de" }).ok === false);
pruefe("eine ungültige E-Mail wird abgewiesen", pruefeNeuePerson({ vorname: "A", nachname: "B", email: "keine-mail" }).ok === false);
pruefe("eine unsinnige Telefonnummer wird abgewiesen", pruefeNeuePerson({ vorname: "A", nachname: "B", email: "a@b.de", telefon: "ruf an" }).ok === false);
{
  const e = pruefeNeuePerson({ vorname: "A", nachname: "B", email: "a@b.de" });
  pruefe("ohne Telefon ist die Eingabe gültig und telefon null", e.ok === true && e.werte.telefon === null, e);
}

function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}

console.log("\n5. Statuswechsel von Hand (M9)");
{
  const ohneGrund = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "VERSTORBEN", grund: "  " });
  pruefe("VERSTORBEN ohne Grund wird abgewiesen (400)", !ohneGrund.ok && ohneGrund.status === 400, ohneGrund);
  const mitGrund = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "VERSTORBEN", grund: " Mitteilung " });
  pruefe("mit Grund geht es, der Grund wird getrimmt", mitGrund.ok && mitGrund.grund === "Mitteilung", mitGrund);
  const abgebrochen = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "ABGEBROCHEN" });
  const ausgeschlossen = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "AUSGESCHLOSSEN" });
  pruefe("auch ABGEBROCHEN und AUSGESCHLOSSEN brauchen einen Grund", !abgebrochen.ok && !ausgeschlossen.ok);
  const beurlaubt = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "BEURLAUBT", grund: "" });
  pruefe("BEURLAUBT geht ohne Grund (leer wird null)", beurlaubt.ok && beurlaubt.grund === null, beurlaubt);
  const anonym = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "ANONYMISIERT", grund: "x" });
  pruefe("ANONYMISIERT ist kein Ziel (eigene Route, 400)", !anonym.ok && anonym.status === 400, anonym);
  const interessent = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "INTERESSENT" });
  pruefe("INTERESSENT ist kein Ziel (400)", !interessent.ok && interessent.status === 400, interessent);
  const gleich = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "AKTIV" });
  pruefe("derselbe Status ist kein Wechsel (400)", !gleich.ok && gleich.status === 400, gleich);
  const endzustand = pruefeStatuswechsel({ vonCode: "VERSTORBEN", vonIstTerminal: true, nachCode: "AKTIV", grund: "Irrtum" });
  pruefe("aus einem Endzustand führt kein Weg heraus (409)", !endzustand.ok && endzustand.status === 409, endzustand);
  const lang = pruefeStatuswechsel({ vonCode: "AKTIV", vonIstTerminal: false, nachCode: "ABGEBROCHEN", grund: "x".repeat(501) });
  pruefe("ein überlanger Grund wird abgewiesen (400)", !lang.ok && lang.status === 400, lang);
  pruefe(
    "nur die Anonymisierung führt aus einem Endzustand heraus",
    darfAusEndzustand("ANONYMISIERT") && !darfAusEndzustand("AKTIV"),
  );
  // Wiederaufnahme nach Abbruch (27.09.2026): ABGEBROCHEN ist kein Endzustand
  // mehr, das Verlassen braucht aber einen Grund.
  const wiederOhne = pruefeStatuswechsel({ vonCode: "ABGEBROCHEN", vonIstTerminal: false, nachCode: "AKTIV", grund: " " });
  pruefe(
    "Wiederaufnahme aus ABGEBROCHEN ohne Grund wird abgewiesen (400, eigene Meldung)",
    !wiederOhne.ok && wiederOhne.status === 400 && wiederOhne.meldung === MELDUNG_WIEDERAUFNAHME_GRUND,
    wiederOhne,
  );
  const wiederMit = pruefeStatuswechsel({ vonCode: "ABGEBROCHEN", vonIstTerminal: false, nachCode: "AKTIV", grund: " Kommt zurück " });
  pruefe("Wiederaufnahme aus ABGEBROCHEN mit Grund geht", wiederMit.ok && wiederMit.grund === "Kommt zurück", wiederMit);
  pruefe(
    "brauchtGrund: das Verlassen von ABGEBROCHEN zählt, andere Herkünfte nicht",
    brauchtGrund("AKTIV", "ABGEBROCHEN") && !brauchtGrund("AKTIV", "BEURLAUBT") && !brauchtGrund("AKTIV"),
  );
  const zieleAbgebrochen = waehlbareZiele(
    ["INTERESSENT", "ANGENOMMEN", "AKTIV", "ABGEBROCHEN", "VERSTORBEN"].map((code) => ({ code })),
    "ABGEBROCHEN",
    false,
  ).map((z) => z.code);
  pruefe(
    "aus ABGEBROCHEN bietet die Oberfläche die Wiederaufnahme an",
    zieleAbgebrochen.join(",") === "ANGENOMMEN,AKTIV,VERSTORBEN",
    zieleAbgebrochen,
  );
  const alle = ["INTERESSENT", "ANGENOMMEN", "AKTIV", "BEURLAUBT", "ABSOLVENT", "VERSTORBEN", "ANONYMISIERT"].map((code) => ({ code }));
  const ziele = waehlbareZiele(alle, "AKTIV", false).map((z) => z.code);
  pruefe(
    "die Oberfläche bietet weder INTERESSENT, ANONYMISIERT noch den aktuellen Status an",
    ziele.join(",") === "ANGENOMMEN,BEURLAUBT,ABSOLVENT,VERSTORBEN",
    ziele,
  );
  pruefe("aus einem Endzustand bietet die Oberfläche nichts an", waehlbareZiele(alle, "VERSTORBEN", true).length === 0);
  const offen = pruefeStatuswechsel({
    vonCode: "INTERESSENT",
    vonIstTerminal: false,
    nachCode: "AKTIV",
    offeneAnmeldung: true,
  });
  pruefe(
    "solange über eine eingereichte Anmeldung nicht entschieden ist, kein Wechsel von Hand (409)",
    !offen.ok && offen.status === 409 && offen.meldung === MELDUNG_ANMELDUNG_OFFEN,
    offen,
  );
  const entschieden = pruefeStatuswechsel({ vonCode: "INTERESSENT", vonIstTerminal: false, nachCode: "AKTIV" });
  pruefe("ohne offene Anmeldung geht der Wechsel von Interessent aus", entschieden.ok, entschieden);
  pruefe(
    "bei offener Anmeldung bietet die Oberfläche kein Ziel an",
    waehlbareZiele(alle, "INTERESSENT", false, true).length === 0 && waehlbareZiele(alle, "INTERESSENT", false).length > 0,
  );
}

console.log("\n6. Ausbildungsdaten (M9)");
{
  const heute = new Date("2026-09-27T00:00:00.000Z");
  const bisher = {
    geburtsdatum: new Date("1990-04-03T00:00:00.000Z"),
    gemeinde: null,
    teilnahmeform: "SCHUELER",
    teilnahmeformenOffen: ["SCHUELER"],
  };
  const mit = { heute, art9Eingewilligt: true };
  const ohne = { heute, art9Eingewilligt: false };

  const datum = pruefeAusbildungsdaten({ geburtsdatum: "1990-04-30" }, bisher, mit);
  pruefe(
    "ein korrigiertes Geburtsdatum wird als Kalendertag (UTC) übernommen",
    datum.ok && datum.person.geburtsdatum?.toISOString() === "1990-04-30T00:00:00.000Z" && datum.felder.join(",") === "geburtsdatum",
    datum,
  );
  const unveraendert = pruefeAusbildungsdaten({ geburtsdatum: "1990-04-03", teilnahmeform: "SCHUELER" }, bisher, mit);
  pruefe("unveränderte Werte ergeben keine Änderung", unveraendert.ok && unveraendert.felder.length === 0, unveraendert);
  const zukunft = pruefeAusbildungsdaten({ geburtsdatum: "2026-09-28" }, bisher, mit);
  pruefe("ein Geburtsdatum in der Zukunft wird abgewiesen (400)", !zukunft.ok && zukunft.status === 400, zukunft);
  const gibtsNicht = pruefeAusbildungsdaten({ geburtsdatum: "1990-02-31" }, bisher, mit);
  pruefe("ein Datum, das es nicht gibt, wird abgewiesen", !gibtsNicht.ok, gibtsNicht);
  const uralt = pruefeAusbildungsdaten({ geburtsdatum: "1899-12-31" }, bisher, mit);
  pruefe("ein Geburtsjahr vor 1900 wird abgewiesen", !uralt.ok, uralt);

  const ohneEinwilligung = pruefeAusbildungsdaten({ gemeinde: "Gemeinde Minden" }, bisher, ohne);
  pruefe(
    "ohne Art.-9-Einwilligung wird keine Gemeinde gespeichert (409)",
    !ohneEinwilligung.ok && ohneEinwilligung.status === 409,
    ohneEinwilligung,
  );
  const leeren = pruefeAusbildungsdaten({ gemeinde: "" }, { ...bisher, gemeinde: "Alt" }, ohne);
  pruefe("leeren geht auch ohne Einwilligung", leeren.ok && leeren.person.gemeinde === null, leeren);
  const mitEinwilligung = pruefeAusbildungsdaten({ gemeinde: "  Gemeinde Minden " }, bisher, mit);
  pruefe(
    "mit Einwilligung wird die Gemeinde getrimmt gespeichert",
    mitEinwilligung.ok && mitEinwilligung.person.gemeinde === "Gemeinde Minden",
    mitEinwilligung,
  );

  const leereForm = pruefeAusbildungsdaten({ teilnahmeform: "" }, bisher, mit);
  pruefe(
    "bei offener Teilnahme lässt sich die Teilnahmeform nicht leeren (400)",
    !leereForm.ok && leereForm.status === 400,
    leereForm,
  );
  const leerOhne = pruefeAusbildungsdaten({ teilnahmeform: "" }, { ...bisher, teilnahmeformenOffen: [] }, mit);
  pruefe(
    "ohne offene Teilnahme lässt sich die Teilnahmeform leeren",
    leerOhne.ok && leerOhne.person.teilnahmeform === null && leerOhne.teilnahmen === null,
    leerOhne,
  );
  const hoerer = pruefeAusbildungsdaten({ teilnahmeform: "HOERER" }, bisher, mit);
  pruefe(
    "ein Formwechsel ändert Person UND offene Teilnahmen",
    hoerer.ok && hoerer.person.teilnahmeform === "HOERER" && hoerer.teilnahmen === "HOERER",
    hoerer,
  );
  const nurTeilnahme = pruefeAusbildungsdaten({ teilnahmeform: "SCHUELER" }, { ...bisher, teilnahmeformenOffen: ["HOERER"] }, mit);
  pruefe(
    "weicht nur die Teilnahme ab, wird nur sie angepasst (Person leer, als Änderung gemeldet)",
    nurTeilnahme.ok &&
      nurTeilnahme.person.teilnahmeform === undefined &&
      Object.keys(nurTeilnahme.person).length === 0 &&
      nurTeilnahme.teilnahmen === "SCHUELER" &&
      nurTeilnahme.felder.join(",") === "teilnahmeform",
    nurTeilnahme,
  );
  const naechstes = pruefeAusbildungsdaten(
    { teilnahmeform: "SCHUELER" },
    { ...bisher, teilnahmeformenOffen: ["SCHUELER", "HOERER"] },
    mit,
  );
  pruefe(
    "eine schon angelegte Teilnahme im nächsten Semester mit alter Form wird mit angepasst",
    naechstes.ok && naechstes.teilnahmen === "SCHUELER" && naechstes.felder.join(",") === "teilnahmeform",
    naechstes,
  );
  const falscheForm = pruefeAusbildungsdaten({ teilnahmeform: "GAST" }, bisher, mit);
  pruefe("eine unbekannte Teilnahmeform wird abgewiesen", !falscheForm.ok, falscheForm);
  const nichts = pruefeAusbildungsdaten({}, bisher, mit);
  pruefe("nicht mitgeschickte Felder bleiben unverändert", nichts.ok && nichts.felder.length === 0, nichts);
}

console.log("\n7. Seed, Recht und der eine Schreibweg (Quelltext, M9)");
const seed = lies("prisma/seed.ts");
function statusBlock(code: string): string {
  const start = seed.indexOf(`code: "${code}",`);
  return start < 0 ? "" : seed.slice(start, seed.indexOf("},", start));
}
const absolvent = statusBlock("ABSOLVENT");
pruefe(
  "ABSOLVENT ist KEIN Endzustand, zählt nicht als aktiv und bekommt keine Automatik-Mails",
  /istTerminal: false,/.test(absolvent) && /istAktiv: false,/.test(absolvent) && /automatikMails: false,/.test(absolvent),
  absolvent,
);
const abgebrochenBlock = statusBlock("ABGEBROCHEN");
pruefe(
  "ABGEBROCHEN ist KEIN Endzustand (Wiederaufnahme), zählt nicht als aktiv und bekommt keine Automatik-Mails",
  /istTerminal: false,/.test(abgebrochenBlock) && /istAktiv: false,/.test(abgebrochenBlock) && /automatikMails: false,/.test(abgebrochenBlock),
  abgebrochenBlock,
);
pruefe(
  "VERSTORBEN, AUSGESCHLOSSEN und ANONYMISIERT bleiben Endzustände",
  ["VERSTORBEN", "AUSGESCHLOSSEN", "ANONYMISIERT"].every((c) => /istTerminal: true,/.test(statusBlock(c))),
);
const rollenStart = seed.indexOf("const ROLLEN = [");
const rollenText = rollenStart >= 0 ? seed.slice(rollenStart, seed.indexOf("\n];", rollenStart)) : "";
const mitStatusRecht = [...rollenText.matchAll(/code: "([A-Z_]+)",[\s\S]*?rechte: \[([\s\S]*?)\]/g)]
  .filter((m) => m[2].includes("RECHT.PERSON_STATUS_WECHSELN"))
  .map((m) => m[1]);
pruefe("PERSON_STATUS_WECHSELN hat nur die Schulleitung", mitStatusRecht.join(",") === "SCHULLEITER", mitStatusRecht);
const statusRoute = lies("src/app/api/personen/[id]/status/route.ts");
const ausbildungRoute = lies("src/app/api/personen/[id]/ausbildungsdaten/route.ts");
pruefe(
  "Status- und Ausbildungsdaten-Route prüfen PERSON_STATUS_WECHSELN",
  /pruefeZugriff\(RECHT\.PERSON_STATUS_WECHSELN\)/.test(statusRoute) &&
    /pruefeZugriff\(RECHT\.PERSON_STATUS_WECHSELN\)/.test(ausbildungRoute),
);
pruefe(
  "die Statusroute reicht eine offene Anmeldung an die Regel weiter",
  /status: AnmeldungStatus\.EINGEREICHT/.test(statusRoute) && /offeneAnmeldung,\s*\}\);/.test(statusRoute),
);
pruefe(
  "die Statusroute schützt den letzten Administrator vor einem Endzustand (409)",
  /waereLetzterAdmin\(\{ istAdmin, verliertZugang: ziel\.istTerminal, andereAdmins: await zaehleAndereAdmins\(person\.id\) \}\)/.test(
    statusRoute,
  ) && /return fehler\(MELDUNG_LETZTER_ADMIN, 409\)/.test(statusRoute),
);
pruefe(
  "Anonymisierung und Rollenentzug nutzen dieselbe Wache „letzter Administrator“",
  /zaehleAndereAdmins\(personId, tx\)/.test(lies("src/lib/anonymisierung-io.ts")) &&
    /waereLetzterAdmin\(\{ istAdmin, verliertZugang: true, andereAdmins \}\)/.test(lies("src/lib/anonymisierung-io.ts")) &&
    /zaehleAndereAdmins\(person\.id\)/.test(lies("src/app/api/personen/[id]/rollen/route.ts")),
);
pruefe(
  "als andere Administratoren zählen nur Konten ohne Endzustand",
  /rolleCode: ROLLE\.ADMIN, personId: \{ not: personId \}, person: \{ status: \{ istTerminal: false \} \}/.test(
    lies("src/lib/status-io.ts"),
  ),
);
pruefe(
  "Ausbildungsdaten: das Personen-Update bekommt nie ein möglicherweise leeres data (Prisma zählte dann 0)",
  !/data:\s*ergebnis\.person\b/.test(ausbildungRoute) &&
    /data: \{ \.\.\.ergebnis\.person, aktualisiertAm: new Date\(\) \}/.test(ausbildungRoute),
);
pruefe(
  "Ausbildungsdaten: offene Teilnahmen = zählend, laufendes oder noch nicht begonnenes Semester",
  /const zeitraum = \{ OR: \[\{ istAktuell: true \}, \{ start: \{ gt: heute \} \}\] \}/.test(ausbildungRoute) &&
    /where: \{ personId: person\.id, \.\.\.TEILNAHME_ZAEHLT, semester: zeitraum \}/.test(ausbildungRoute),
);
// Code-Review 4: Ein Formwechsel ließ abgemeldete Teilnahmen aus — nach einer
// Wiederaufnahme galt dann die alte Form. Für die REGEL (Form darf nicht leer
// werden) zählen sie weiterhin nicht.
pruefe(
  "Ausbildungsdaten: die Regel bekommt nur die zählenden Teilnahmen",
  /teilnahmeformenOffen: offeneTeilnahmen\.map\(\(t\) => t\.teilnahmeform\)/.test(ausbildungRoute) &&
    !/teilnahmeformenOffen:[^\n]*abgemeldete/.test(ausbildungRoute),
);
pruefe(
  "Ausbildungsdaten: ein Formwechsel passt auch abgemeldete Teilnahmen desselben Zeitraums an",
  /where: \{ personId: person\.id, abgemeldetAm: \{ not: null \}, semester: zeitraum \}/.test(ausbildungRoute) &&
    /id: \{ in: \[\.\.\.offeneTeilnahmen, \.\.\.abgemeldeteTeilnahmen\]\.map\(\(t\) => t\.id\) \}/.test(ausbildungRoute),
);
pruefe(
  "Ausbildungsdaten: weicht nur eine abgemeldete Teilnahme von der gewählten Form ab, wird sie trotzdem angeglichen",
  /where: \{ personId: person\.id, abgemeldetAm: \{ not: null \}, semester: zeitraum \},\s*select: \{ id: true, teilnahmeform: true \}/.test(
    ausbildungRoute,
  ) &&
    /abgemeldeteTeilnahmen\.some\(\(t\) => t\.teilnahmeform !== gewaehlteForm\)/.test(ausbildungRoute) &&
    /if \(ergebnis\.felder\.length === 0 && !nurAbgemeldete\) \{/.test(ausbildungRoute) &&
    /const felder = nurAbgemeldete \? \["teilnahmeform"\] : ergebnis\.felder;/.test(ausbildungRoute),
);
pruefe(
  "Ausbildungsdaten: ohne abweichende zählende Teilnahme gilt die neue Personenform auch für abgemeldete",
  /const neueForm = ergebnis\.teilnahmen \?\? ergebnis\.person\.teilnahmeform \?\? gewaehlteForm;/.test(ausbildungRoute),
);
pruefe(
  "Detailakte: der Hinweis zum Formwechsel nennt abgemeldete Teilnahmen mit (als „abgemeldet“)",
  /t\.abgemeldetAm \? `\$\{t\.semester\.bezeichnung\} \(abgemeldet\)` : t\.semester\.bezeichnung/.test(
    lies("src/app/verwaltung/personen/[id]/page.tsx"),
  ),
);
pruefe(
  "Zeugnisseite: Absolventen bleiben in Übersicht, Vorschau und Sammellauf (ZEUGNIS_PERSON)",
  /const ZEUGNIS_PERSON = \{\s*status: \{\s*OR: \[\{ istAktiv: true \}, \{ code: STATUS\.ABSOLVENT \}\],\s*istTerminal: false,/.test(
    lies("src/lib/zeugnis-io.ts"),
  ),
);
function quelltext(ordner: string): string[] {
  try {
    return readdirSync(ordner).flatMap((eintrag) => {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) return quelltext(pfad);
      return /\.(ts|tsx)$/.test(pfad) ? [pfad] : [];
    });
  } catch {
    return [];
  }
}
const statusSchreiber = quelltext("src").filter((pfad) => /statusWechsel\.create\(/.test(lies(pfad)));
pruefe(
  "StatusWechsel-Zeilen schreibt nur status-io.ts (ein Weg für alle Statuswechsel)",
  statusSchreiber.length === 1 && statusSchreiber[0].endsWith("status-io.ts"),
  statusSchreiber,
);

console.log("\n8. Rückfrage vor dem Rollenwechsel und Klartext-IBAN (Quelltext, Code-Review 4)");
{
  const aktionen = lies("src/components/personen/person-aktionen.tsx");
  pruefe(
    "die Rollenverwaltung rechnet denselben Diff wie der Server und fragt mit Entzogen/Hinzu nach",
    /const diff = rollenDiff\(gewaehlt, person\.rollenCodes\);/.test(aktionen) &&
      /`Entzogen: \$\{diff\.weg\.map\(bezeichnung\)/.test(aktionen) &&
      /`Hinzu: \$\{diff\.hinzu\.map\(bezeichnung\)/.test(aktionen) &&
      /if \(!confirm\(`Rollen von \$\{person\.name\} ändern\?/.test(aktionen),
  );
  pruefe(
    "ohne Änderung geht keine Anfrage raus; beim Selbst-Entzug von ADMIN warnt ein eigener Satz",
    /if \(!rollenGeaendert\) return;/.test(aktionen) && /istEigeneAkte && entziehtAdmin\(diff\)/.test(aktionen),
  );
  pruefe(
    "die Detailakte reicht „eigene Akte“ an die Aktionen weiter",
    /istEigeneAkte=\{eigeneAkte\}/.test(lies("src/app/verwaltung/personen/[id]/page.tsx")),
  );
  pruefe(
    "Anonymisieren steht nicht bei den Alltagsaktionen, sondern als letzter, roter Eintrag im Menü „…“",
    (() => {
      const anonym = aktionen.indexOf('text: "Anonymisieren …"');
      return (
        anonym > 0 &&
        /text: "Anonymisieren …",\s*icon: "person-entfernen",\s*aktion: anonymisieren,\s*gefahr: true,\s*trenner: punkte\.length > 0,/.test(aktionen) &&
        aktionen.lastIndexOf("punkte.push(") < anonym
      );
    })(),
  );
}
{
  const bank = lies("src/app/api/personen/[id]/bankverbindung/route.ts");
  const rueckgaben = bank.match(/^\s*(?:if \([^)]*\) )?return\b/gm) ?? [];
  const ohneCache = bank.match(/return ohneCache\(/g) ?? [];
  pruefe(
    "die Klartext-IBAN gibt es nur per POST (kein GET — die Herkunftsprüfung greift)",
    /export async function POST\(/.test(bank) && !/export async function GET\(/.test(bank),
  );
  pruefe("die Bankverbindung prüft RECHT.BANKVERBINDUNG_LESEN", /pruefeZugriff\(RECHT\.BANKVERBINDUNG_LESEN\)/.test(bank));
  pruefe(
    "jede Antwort der Bankverbindung trägt Cache-Control: no-store",
    /antwort\.headers\.set\("Cache-Control", "no-store"\)/.test(bank) &&
      // Alle return-Anweisungen außer der im Helfer selbst gehen durch ohneCache.
      ohneCache.length > 0 &&
      ohneCache.length === rueckgaben.length - 1,
    { rueckgaben: rueckgaben.length, ohneCache: ohneCache.length },
  );
}

console.log("\n9. Rechte-Codes: Seed und RECHT deckungsgleich, keine rohen Literale");
{
  const konstanten = lies("src/lib/constants.ts");
  const rechtBlockStart = konstanten.indexOf("export const RECHT = {");
  const rechtBlock =
    rechtBlockStart >= 0 ? konstanten.slice(rechtBlockStart, konstanten.indexOf("} as const;", rechtBlockStart)) : "";
  const rechtCodes = [...rechtBlock.matchAll(/^\s*([A-Z_]+): "\1",/gm)].map((m) => m[1]);
  const rechteStart = seed.indexOf("const RECHTE = [");
  const rechteText = rechteStart >= 0 ? seed.slice(rechteStart, seed.indexOf("\n];", rechteStart)) : "";
  const seedCodes = [...rechteText.matchAll(/\{ code: RECHT\.([A-Z_]+),/g)].map((m) => m[1]);
  const eintraege = rechteText.match(/\{ code: /g) ?? [];
  pruefe("RECHT ist lesbar (mehr als 20 Codes)", rechtCodes.length > 20, rechtCodes.length);
  pruefe(
    "jedes Recht aus RECHT wird geseedet",
    rechtCodes.every((c) => seedCodes.includes(c)),
    rechtCodes.filter((c) => !seedCodes.includes(c)),
  );
  pruefe(
    "der Seed legt kein Recht an, das RECHT nicht kennt, und nimmt jeden Code aus RECHT",
    seedCodes.length === eintraege.length && seedCodes.every((c) => rechtCodes.includes(c)),
    { seed: seedCodes.length, eintraege: eintraege.length },
  );
  const rollenRechte = [...rollenText.matchAll(/rechte: \[([^\]]*)\]/g)].map((m) => m[1]).join(",");
  pruefe(
    "die Rollen im Seed nennen ihre Rechte nur über RECHT.*",
    rollenRechte.includes("RECHT.") && !/"[A-Z_]+"/.test(rollenRechte.replace(/\/\/.*$/gm, "")),
  );
  const ohneFunktion = ["MAIL_VERTEILER_SENDEN", "MAIL_VORLAGEN_BEARBEITEN", "FINANZ_DATEN_LESEN", "IMPERSONATION"];
  const nutzung = quelltext("src")
    .filter((pfad) => !pfad.endsWith("constants.ts"))
    .map((pfad) => lies(pfad))
    .join("\n");
  pruefe(
    "Rechte ohne Prüfstelle tragen im Seed „(noch ohne Funktion)“ — und nur solange keine Prüfstelle existiert",
    ohneFunktion.every((c) => {
      const zeile = rechteText.split("\n").find((z) => z.includes(`code: RECHT.${c},`)) ?? "";
      const genutzt = new RegExp(`RECHT\\.${c}\\b`).test(nutzung);
      return zeile.includes("(noch ohne Funktion)") !== genutzt;
    }),
  );
  const roheLiterale = quelltext("src").filter((pfad) =>
    /(?:ladeMitRecht|pruefeZugriff)\("|hatRecht\([^,()]+, *"|rechte\.has\("/.test(lies(pfad)),
  );
  pruefe("kein Rechte-Code als rohes Literal an ladeMitRecht/pruefeZugriff/hatRecht", roheLiterale.length === 0, roheLiterale);
  const berechtigung = lies("src/lib/berechtigung.ts");
  pruefe(
    "ladeMitRecht, pruefeZugriff und hatRecht nehmen RechtCode statt string",
    /export async function ladeMitRecht\(recht: RechtCode\)/.test(berechtigung) &&
      /export async function pruefeZugriff\(recht: RechtCode\)/.test(berechtigung) &&
      /export function hatRecht\(benutzer: AngemeldeteBenutzer \| null, recht: RechtCode\)/.test(berechtigung),
  );
}

console.log("\n10. API-Routen: 401 (nicht angemeldet) getrennt von 403 (keine Berechtigung)");
{
  const berechtigung = lies("src/lib/berechtigung.ts");
  const zugriff = berechtigung.slice(berechtigung.indexOf("export async function pruefeZugriff("));
  pruefe(
    "pruefeZugriff: ohne Sitzung 401, ohne Recht 403",
    /if \(!benutzer\) return nichtAngemeldet\(\);\s*if \(!benutzer\.rechte\.has\(recht\)\) return keineBerechtigung\(\);/.test(
      zugriff,
    ),
  );
  const routen = quelltext("src/app/api").filter((pfad) => pfad.endsWith("route.ts"));
  const mitLadeMitRecht = routen.filter((pfad) => /ladeMitRecht\(/.test(lies(pfad)));
  pruefe("keine API-Route nutzt ladeMitRecht (es kennt nur null für beide Fälle)", mitLadeMitRecht.length === 0, mitLadeMitRecht);
  const blossesNull = routen.filter((pfad) => /if \(!benutzer\) (?:\{\s*)?return (?:ohneCache\()?keineBerechtigung\(\)/.test(lies(pfad)));
  pruefe("keine API-Route antwortet ohne Sitzung mit 403", blossesNull.length === 0, blossesNull);
  const nutzen = routen.filter((pfad) => /pruefeZugriff\(RECHT\.[A-Z_]+\)/.test(lies(pfad)));
  pruefe("mindestens 40 Routen prüfen über pruefeZugriff", nutzen.length >= 40, nutzen.length);
  const client = lies("src/lib/api-client.ts");
  pruefe(
    "der Browser-Client zeigt bei 401 ohne Text „Sitzung abgelaufen“ statt „Keine Berechtigung.“",
    /export const SITZUNG_ABGELAUFEN =/.test(client) &&
      /antwort\.status === 401 \? SITZUNG_ABGELAUFEN/.test(client) &&
      /return fehler\(SITZUNG_ABGELAUFEN, 401\)/.test(lies("src/lib/api.ts")),
  );
  const entwurf = lies("src/app/api/formulare/entwurf/route.ts");
  pruefe(
    "die Entwurf-Route antwortet über erfolg()/fehler() statt NextResponse.json",
    /return erfolg\(\{ versionId \}\)/.test(entwurf) && !/NextResponse\.json/.test(entwurf),
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 97;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

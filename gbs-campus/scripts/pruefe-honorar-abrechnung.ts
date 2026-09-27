/**
 * Gegenprobe für die Honorar-Abrechnung (DB-frei): der Zahlungsbeleg (Positionen,
 * Summe, IBAN in Vierergruppen), die hinterlegte Grundlage (Recht) und die
 * Korrekturwege aus Code-Review 4 — Sperre des Dozentenwechsels an abgerechneten
 * Abenden und Storno (M11), Nachversand des DMS-Belegs mit ehrlicher Rückmeldung
 * (M12) — sowie die HTTP-Codes der Schreibwege und die Oberflächen-Absicherung
 * (Rückfragen, gesperrte Freigabe, Hinweis ohne DMS-Adresse).
 *
 * ACHTUNG beim Erweitern: Eine Prüfung beweist erst dann etwas, wenn sie ROT
 * wird, sobald man die geprüfte Regel entfernt.
 */

import { readFileSync } from "fs";
import {
  baueAbrechnungBelegBloecke,
  baueAbrechnungDmsMail,
  type AbrechnungBelegDaten,
} from "../src/lib/honorar-abrechnung-beleg";
import {
  DMS_NICHT_EINGERICHTET,
  dozentWechselSperre,
  dmsVersandText,
  istDmsVersand,
  nachversandErgebnis,
  pruefeAbrechnungNachversand,
  statusFuer,
} from "../src/lib/honorar-korrektur";
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

console.log("\n1. Zahlungsbeleg (Positionen, Summe, IBAN)");
const daten: AbrechnungBelegDaten = {
  belegNr: "HONA-2026-07-30-ABCD1234",
  erzeugtAm: d("2026-07-30T10:00:00"),
  dozent: "Dozento, Dora",
  semester: "Herbstsemester 2026",
  statusText: "Freigegeben zur Auszahlung",
  kontoinhaber: "Dora Dozento",
  iban: "DE02120300000000202051",
  freigegebenVon: "Verwalta, Vera",
  freigegebenAm: d("2026-07-30T10:00:00"),
  ausgezahltAm: null,
  posten: [
    { datum: d("2026-08-25T19:00:00"), fach: "Bibelkunde Altes Testament", betrag: 60 },
    { datum: d("2026-09-01T19:00:00"), fach: "Kirchengeschichte", betrag: 70 },
  ],
  summe: 130,
  notiz: null,
};
const bloecke = baueAbrechnungBelegBloecke(daten);
const alsText = JSON.stringify(bloecke);
pruefe("der Beleg hat einen Titel-Block", bloecke.some((b) => b.art === "titel"));
pruefe("die Beleg-Nummer steht im Beleg", alsText.includes("HONA-2026-07-30-ABCD1234"));
pruefe("der Dozent steht im Beleg", alsText.includes("Dozento, Dora"));
pruefe("der Kontoinhaber steht im Beleg", alsText.includes("Dora Dozento"));
pruefe("die IBAN steht in Vierergruppen im Beleg", alsText.includes("DE02 1203 0000 0000 2020 51"));
pruefe("beide Positionen (Fach) stehen im Beleg", alsText.includes("Bibelkunde Altes Testament") && alsText.includes("Kirchengeschichte"));
pruefe("die unterschiedlichen Beträge je Abend stehen im Beleg", alsText.includes("60 €") && alsText.includes("70 €"));
pruefe("die Summe (130 €) steht im Beleg", alsText.includes("130 €"));
pruefe("der Freigeber steht im Beleg", alsText.includes("Verwalta, Vera"));
pruefe("der Erstbeleg trägt keinen Nachversand-Vermerk", !alsText.includes("NACHVERSAND"));
const nachText = JSON.stringify(baueAbrechnungBelegBloecke({ ...daten, nachversand: true }));
pruefe(
  "Nachversand: das PDF selbst trägt „NACHVERSAND – Kopie … nicht erneut anweisen“ mit der Beleg-Nr",
  nachText.includes(`NACHVERSAND – Kopie des Belegs ${daten.belegNr}, nicht erneut anweisen`),
);
const pdf = erzeugePdf(bloecke);
pruefe("erzeugePdf liefert eine gültige PDF (Kopf %PDF)", pdf.subarray(0, 5).toString("latin1") === "%PDF-");
pruefe("die PDF ist nicht leer", pdf.length > 500);

console.log("\n2. Das Recht HONORAR_ABRECHNEN ist geseedet und den richtigen Rollen zugeordnet");
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
  "HONORAR_ABRECHNEN ist als Recht im Bereich FINANZEN angelegt",
  /code: RECHT\.HONORAR_ABRECHNEN,[\s\S]{0,140}bereich: "FINANZEN"/.test(seed),
);
pruefe("die Schulleitung darf abrechnen", rechteVon("SCHULLEITER").includes("HONORAR_ABRECHNEN"));
pruefe("die Verwaltung darf abrechnen", rechteVon("VERWALTUNG").includes("HONORAR_ABRECHNEN"));
pruefe(
  "der Teilnehmer darf NICHT abrechnen",
  rechteVon("TEILNEHMER").length > 0 && !rechteVon("TEILNEHMER").includes("HONORAR_ABRECHNEN"),
);

console.log("\n3. Dozentenwechsel an einem abgerechneten Abend (M11)");
pruefe("nicht abgerechnet: der Dozent lässt sich frei umhängen", dozentWechselSperre("dozent-a", "dozent-b", null) === null);
pruefe(
  "abgerechnet, aber derselbe Dozent (reine Fach-Korrektur): erlaubt",
  dozentWechselSperre("dozent-a", "dozent-a", "OFFEN") === null,
);
pruefe("abgerechnet, Dozent nicht mitgeschickt: erlaubt", dozentWechselSperre("dozent-a", undefined, "FREIGEGEBEN") === null);
const sperreOffen = dozentWechselSperre("dozent-a", "dozent-b", "OFFEN");
pruefe(
  "OFFENE Abrechnung: anderer Dozent gesperrt, Meldung verweist auf den Storno",
  sperreOffen !== null && sperreOffen.includes("stornieren"),
  sperreOffen,
);
const sperreFrei = dozentWechselSperre("dozent-a", "dozent-b", "FREIGEGEBEN");
pruefe(
  "FREIGEGEBENE Abrechnung: gesperrt, ohne Verweis auf einen Storno (den es dafür nicht gibt)",
  sperreFrei !== null && !sperreFrei.includes("stornieren"),
  sperreFrei,
);
pruefe("auch das Entfernen des Dozenten (null) ist bei einem abgerechneten Abend gesperrt", dozentWechselSperre("dozent-a", null, "AUSGEZAHLT") !== null);

console.log("\n4. Nachversand des Zahlungsbelegs: wann erlaubt (M12)");
const mitBeleg = { belegNr: "HONA-2026-07-30-ABCD1234", dmsGesendetAm: null };
pruefe("OFFEN: kein Nachversand (es gibt noch keinen Beleg)", pruefeAbrechnungNachversand({ ...mitBeleg, status: "OFFEN" }) !== null);
pruefe("FREIGEGEBEN, Beleg nicht angekommen: Nachversand erlaubt", pruefeAbrechnungNachversand({ ...mitBeleg, status: "FREIGEGEBEN" }) === null);
pruefe("AUSGEZAHLT, Beleg nicht angekommen: Nachversand erlaubt", pruefeAbrechnungNachversand({ ...mitBeleg, status: "AUSGEZAHLT" }) === null);
pruefe(
  "bereits gesendet: kein zweiter Versand",
  pruefeAbrechnungNachversand({ ...mitBeleg, status: "FREIGEGEBEN", dmsGesendetAm: d("2026-07-30T10:05:00") }) !== null,
);
pruefe("ohne Beleg-Nr: kein Nachversand", pruefeAbrechnungNachversand({ status: "FREIGEGEBEN", belegNr: null, dmsGesendetAm: null }) !== null);

console.log("\n5. Nachversand: Ausgang → Antwort der Route");
const gesendet = nachversandErgebnis("HONA-X", "GESENDET");
pruefe("gesendet ⇒ ok mit derselben Beleg-Nr", gesendet.ok && gesendet.belegNr === "HONA-X", gesendet);
const gescheitert = nachversandErgebnis("HONA-X", "FEHLGESCHLAGEN");
pruefe(
  "nicht zugestellt ⇒ 500; die Ursache sieht der Administrator (Betrieb ist nur für ihn erreichbar)",
  !gescheitert.ok &&
    statusFuer(gescheitert.code) === 500 &&
    gescheitert.meldung.includes("Administrator") &&
    gescheitert.meldung.includes("Betrieb"),
  gescheitert,
);
const ohneAdresse = nachversandErgebnis("HONA-X", "KEINE_ADRESSE");
pruefe(
  "keine DMS-Adresse ⇒ 500 mit Nennung von DMS_EMAIL",
  !ohneAdresse.ok && statusFuer(ohneAdresse.code) === 500 && ohneAdresse.meldung.includes("DMS_EMAIL"),
  ohneAdresse,
);
const laeuft = nachversandErgebnis("HONA-X", "LAEUFT");
pruefe("läuft gerade (Sperre belegt) ⇒ 409", !laeuft.ok && statusFuer(laeuft.code) === 409, laeuft);
const schon = nachversandErgebnis("HONA-X", "SCHON_GESENDET");
pruefe("inzwischen gesendet ⇒ 409", !schon.ok && statusFuer(schon.code) === 409, schon);
pruefe("unbekannte Abrechnung ⇒ 404", statusFuer("fehlt") === 404);
pruefe("fachliche Eingabe-Ablehnung ⇒ 400, Konflikt ⇒ 409", statusFuer("eingabe") === 400 && statusFuer("konflikt") === 409);

console.log("\n6. Rückmeldung nach Freigabe/Genehmigung: der echte Ausgang (M12)");
const textFehl = dmsVersandText("HONA-X", "FEHLGESCHLAGEN");
pruefe(
  "nicht zugestellt: keine pauschale Ursache „E-Mail noch nicht eingerichtet“",
  !textFehl.includes("noch nicht eingerichtet"),
  textFehl,
);
pruefe(
  "nicht zugestellt: verweist für die Ursache auf den Administrator (Betrieb) und nennt „Beleg erneut senden“",
  textFehl.includes("Administrator") && textFehl.includes("Betrieb") && textFehl.includes("Beleg erneut senden"),
  textFehl,
);
pruefe("keine DMS-Adresse: nennt DMS_EMAIL", dmsVersandText("HONA-X", "KEINE_ADRESSE").includes("DMS_EMAIL"));
const textOk = dmsVersandText("HONA-X", "GESENDET");
pruefe("gesendet: meldet den Versand ohne Einschränkung", textOk.includes("gesendet") && !textOk.includes("nicht"), textOk);
pruefe(
  "?freigabe= nimmt nur echte Versand-Ausgänge an",
  ["GESENDET", "KEINE_ADRESSE", "FEHLGESCHLAGEN", "LAEUFT"].every((w) => istDmsVersand(w)) &&
    !istDmsVersand("SCHON_GESENDET") &&
    !istDmsVersand("<script>") &&
    !istDmsVersand(undefined),
);
pruefe(
  "ohne DMS-Adresse: Hinweis nennt DMS_EMAIL und den Administrator statt eines Knopfs, der sicher scheitert",
  DMS_NICHT_EINGERICHTET.includes("DMS_EMAIL") && DMS_NICHT_EINGERICHTET.includes("Administrator"),
);

console.log("\n7. Begleitmail ans DMS (Erstversand und Nachversand)");
const mailErst = baueAbrechnungDmsMail(daten, false);
const mailNach = baueAbrechnungDmsMail(daten, true);
pruefe("der Betreff trägt die Beleg-Nr", mailErst.betreff.includes(daten.belegNr) && mailNach.betreff.includes(daten.belegNr));
pruefe(
  "kein Dozentenname im Betreff (email_versand wird von der Anonymisierung nicht erfasst)",
  !mailErst.betreff.includes("Dozento") && !mailNach.betreff.includes("Dozento"),
  [mailErst.betreff, mailNach.betreff],
);
pruefe("Erstversand: ohne Nachversand-Vermerk", !mailErst.betreff.includes("Nachversand") && !mailErst.text.includes("NACHVERSAND"));
pruefe(
  "Nachversand: Vermerk im Betreff und Warnung vor doppelter Anweisung im Text",
  mailNach.betreff.includes("Nachversand") && mailNach.text.includes("nicht erneut anweisen"),
  mailNach,
);
pruefe("der Anhang heißt wie die Beleg-Nr", mailErst.dateiname === `${daten.belegNr}.pdf`);

console.log("\n8. Die Regeln sind an den Schreibpfaden verdrahtet (Quelltext)");
function lies(pfad: string): string {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return "";
  }
}
const terminPut = lies("src/app/api/stundenplan/termine/[id]/route.ts").split("export async function DELETE")[0];
pruefe(
  "der Termin-PUT prüft den Dozentenwechsel gegen den Abrechnungsposten, unter Zeilensperre (FOR UPDATE)",
  /dozentWechselSperre\(/.test(terminPut) && /honorarAbrechnungPosten/.test(terminPut) && /FOR UPDATE/.test(terminPut),
);
const abrIo = lies("src/lib/honorar-abrechnung-io.ts");
pruefe(
  "erstelleAbrechnung prüft nach dem Anlegen die Dozentenzuordnung der Abende (Gegenprobe)",
  /unterrichtstermin\.count\(\{[\s\S]{0,120}dozentId[\s\S]{0,200}throw new ZuordnungGeaendert/.test(abrIo),
);
pruefe(
  "der Storno löscht atomar nur OFFENE Abrechnungen (bedingtes deleteMany)",
  /honorarAbrechnung\.deleteMany\(\{\s*where:\s*\{\s*id:\s*abrechnungId,\s*status:\s*"OFFEN"\s*\}/.test(abrIo),
);
pruefe(
  "Freigabe und Nachversand senden über denselben Weg unter der DMS-Sperre",
  (abrIo.match(/versendeAbrechnungsBeleg\(/g) ?? []).length >= 3 && /mitDmsSperre\(/.test(abrIo),
);
pruefe(
  "unter der Sperre liest der Abrechnungs-Versand über tx und reicht den Nachversand ins PDF",
  /ladeAkteurNamen\(\[a\.freigegebenVonId\], tx\)/.test(abrIo) && /notiz: a\.notiz,\s*nachversand,/.test(abrIo),
);
pruefe(
  "scheitert nach der angenommenen Mail die Sperr-Transaktion, wird dmsGesendetAm bedingt nachgetragen (kein FEHLGESCHLAGEN)",
  /honorarAbrechnung\.updateMany\(\{\s*where: \{ id: abrechnungId, dmsGesendetAm: null \}/.test(abrIo) && /if \(!am\) throw fehler;/.test(abrIo),
);
pruefe(
  "die Schreibwege tragen einen Code: fehlt (404), konflikt (409), server (500), eingabe (400)",
  /if \(!a\) return \{ ok: false, code: "fehlt", meldung: "Diese Abrechnung gibt es nicht\." \};/.test(abrIo) &&
    /code: "konflikt", meldung: "Nur eine offene Abrechnung kann freigegeben werden\."/.test(abrIo) &&
    /code: "server",\s*meldung: "Die Bankverbindung ist nicht lesbar/.test(abrIo) &&
    /code: "konflikt", meldung: "Diese Abrechnung wurde zwischenzeitlich schon freigegeben\."/.test(abrIo) &&
    /code: "eingabe",\s*meldung: "Für diesen Dozenten gibt es in diesem Semester keine offenen/.test(abrIo) &&
    /code: "konflikt",\s*meldung: "Die Abrechnung konnte nicht angelegt werden — ein Abend wurde zwischenzeitlich schon abgerechnet/.test(abrIo) &&
    /code: "konflikt", meldung: "Nur eine freigegebene Abrechnung kann als ausgezahlt markiert werden\."/.test(abrIo),
);
const schreibRouten = [
  lies("src/app/api/honorar/abrechnungen/route.ts"),
  lies("src/app/api/honorar/abrechnungen/[id]/freigeben/route.ts"),
  lies("src/app/api/honorar/abrechnungen/[id]/auszahlen/route.ts"),
];
pruefe(
  "Abrechnen, Freigeben und Auszahlen bilden das fachliche Nein über statusFuer ab (nicht pauschal 400)",
  schreibRouten.every(
    (q) => /if \(!ergebnis\.ok\) return fehler\(ergebnis\.meldung, statusFuer\(ergebnis\.code\)\);/.test(q) && !/fehler\(ergebnis\.meldung, 400\)/.test(q),
  ),
);
const stornoRoute = lies("src/app/api/honorar/abrechnungen/[id]/route.ts");
pruefe(
  "die Storno-Route (DELETE) verlangt HONORAR_ABRECHNEN",
  /export async function DELETE/.test(stornoRoute) && /RECHT\.HONORAR_ABRECHNEN/.test(stornoRoute) && /storniereAbrechnung\(/.test(stornoRoute),
);
const nachsendeRoute = lies("src/app/api/honorar/abrechnungen/[id]/beleg-senden/route.ts");
pruefe(
  "die Nachsende-Route verlangt dieselben Rechte wie die Freigabe (inkl. BANKVERBINDUNG_LESEN)",
  /RECHT\.HONORAR_ABRECHNEN/.test(nachsendeRoute) &&
    /hatRecht\(benutzer, RECHT\.BANKVERBINDUNG_LESEN\)/.test(nachsendeRoute) &&
    /sendeAbrechnungsBelegNach\(/.test(nachsendeRoute),
);
const freigebenKnopf = lies("src/app/verwaltung/honorar/abrechnungen/[id]/freigeben-knopf.tsx");
const satzForm = lies("src/app/verwaltung/honorar/saetze/satz-form.tsx");
const detailSeite = lies("src/app/verwaltung/honorar/abrechnungen/[id]/page.tsx");
pruefe(
  "Freigabe (über die Detailseite) und Satz-Formular melden den echten Ausgang (dmsVersandText) statt der pauschalen Ursache",
  [detailSeite, satzForm].every((q) => q.includes("dmsVersandText(")) &&
    [freigebenKnopf, detailSeite, satzForm].every((q) => q.length > 0 && !q.includes("noch nicht eingerichtet")),
);
pruefe(
  "der Freigabe-Knopf gibt den Ausgang als ?freigabe= weiter (er hängt nach dem Statuswechsel aus)",
  /router\.replace\(`\/verwaltung\/honorar\/abrechnungen\/\$\{abrechnungId\}\?freigabe=\$\{antwort\.daten\.dmsVersand\}`\)/.test(freigebenKnopf) &&
    !/router\.refresh\(\)/.test(freigebenKnopf),
);
pruefe(
  "die Detailseite zeigt den Freigabe-Ausgang nur geprüft (istDmsVersand) und nur, solange er zum Stand passt",
  /istDmsVersand\(sp\.freigabe\)/.test(detailSeite) && /\(freigabe === "GESENDET"\) === \(a\.dmsGesendetAm !== null\)/.test(detailSeite),
);
pruefe(
  "ohne Bankverbindung ist „Freigeben“ gesperrt (mit sichtbarem Grund), der statische Hinweis ohne role=\"alert\"",
  /disabled=\{laeuft \|\| Boolean\(gesperrtGrund\)\}/.test(freigebenKnopf) &&
    /\{gesperrtGrund\}/.test(freigebenKnopf) &&
    /gesperrtGrund=\{a\.hatBankverbindung \? null : /.test(detailSeite) &&
    !/role="alert"/.test(detailSeite),
);
pruefe(
  "der Hinweis ohne IBAN nennt „Meine Daten“ und verlinkt die Akte des Dozenten",
  /unter „Meine Daten“ ein/.test(detailSeite) && /href=\{`\/verwaltung\/personen\/\$\{a\.dozentId\}`\}/.test(detailSeite),
);
pruefe(
  "ohne DMS-Adresse zeigt die Detailseite statt „Beleg erneut senden“ und der Nachsende-Aufforderung den Grund",
  /const dmsEingerichtet = dmsAdresse\(\) !== null;/.test(detailSeite) &&
    /!dmsEingerichtet \?\s*\(\s*<span[^>]*>\{DMS_NICHT_EINGERICHTET\}/.test(detailSeite) &&
    /: `Der Zahlungsbeleg ist noch nicht im DMS angekommen\. \$\{DMS_NICHT_EINGERICHTET\}`/.test(detailSeite),
);
const abrechnenKnopf = lies("src/app/verwaltung/honorar/abrechnungen/abrechnen-knopf.tsx");
const uebersichtAbr = lies("src/app/verwaltung/honorar/abrechnungen/page.tsx");
pruefe(
  "„Abrechnen“ fragt mit Dozent, Abenden und Betrag nach und trägt den Dozenten im aria-label",
  /`Abrechnung für \$\{dozentName\} erstellen \(/.test(abrechnenKnopf) &&
    /\$\{betrag\}\)\? /.test(abrechnenKnopf) &&
    /aria-label=\{`Abrechnen: \$\{dozentName\}`\}/.test(abrechnenKnopf) &&
    /dozentName=\{z\.name\}/.test(uebersichtAbr) &&
    /betrag=\{euro\(z\.offenBetrag\)\}/.test(uebersichtAbr),
);
pruefe(
  "die Detailseite bietet „Beleg erneut senden“ und „Abrechnung stornieren“ an",
  /<BelegNachsendenKnopf/.test(detailSeite) && /<StornierenKnopf/.test(detailSeite),
);
pruefe(
  "die Freigabe-Rückmeldung steht als MeldungsBox oben (dauerhafte Live-Region in jedem Stand, nicht erst im Zweig FREIGEGEBEN)",
  /<MeldungsBox\s+meldung=\{\s*freigabeText/.test(detailSeite) &&
    detailSeite.indexOf("<MeldungsBox") < detailSeite.indexOf("<dl") &&
    !/\{freigabeText && \(/.test(detailSeite),
);
pruefe(
  "nach dem Einrichten von DMS_EMAIL ist „keine DMS-Adresse“ überholt, und die Aufforderung zum Nachsenden erscheint",
  /!\(freigabe === "KEINE_ADRESSE" && dmsEingerichtet\)/.test(detailSeite) &&
    /const keineAdresseGemeldet = freigabe === "KEINE_ADRESSE" && !dmsEingerichtet;/.test(detailSeite) &&
    /\{!a\.dmsGesendetAm && !keineAdresseGemeldet && \(/.test(detailSeite),
);
pruefe(
  "„Abrechnen“ schickt Abende und Summe der Rückfrage mit; weicht der Stand ab, legt erstelleAbrechnung nichts an (409)",
  /rumpf: \{ dozentId, semesterId, erwarteteAbende: abende, erwarteteSumme: summe \}/.test(abrechnenKnopf) &&
    /summe=\{z\.offenBetrag\}/.test(uebersichtAbr) &&
    /if \(erwartet && \(posten\.length !== erwartet\.abende \|\| summe !== erwartet\.summe\)\) \{\s*return \{\s*ok: false,\s*code: "konflikt",/.test(abrIo) &&
    abrIo.indexOf("if (erwartet &&") < abrIo.indexOf("prisma.$transaction(async (tx) => {\n      const angelegt"),
);
pruefe(
  "die Meldung ohne IBAN schickt die Verwaltung nicht auf einen Weg, den es nicht gibt („Meine Daten“ statt „IBAN erfassen“)",
  !/IBAN erfassen/.test(abrIo) && (abrIo.match(/Die IBAN trägt der Dozent selbst unter „Meine Daten“ ein\./g) ?? []).length === 2,
);

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 70;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

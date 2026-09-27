/**
 * Gegenprobe für Etappe 2 des Oberflächenplans 09/2026 („Heute“, Personen,
 * Anmeldungen), DB-frei.
 *
 * Geprüft werden die Regeln und Wortlaute aus src/lib/heute.ts (Anwesenheit
 * „im Soll / 2× entschuldigt / 3× gefehlt“, Zeitangaben, Abende, Überleitung,
 * „Zuletzt“) und src/lib/anmeldung-lesen.ts (die Lesefassung einer Anmeldung),
 * dazu wenige Stellen im Quelltext, an denen der Datenschutz hängt. Die Beispiele
 * sind die Demo-Daten des Plans (Herbstsemester 2026, heute Sonntag, 27.09.).
 *
 * Läuft in Europe/Berlin (pruefe-alle.ts setzt TZ) — Tagesgrenzen und
 * Uhrzeiten sind Berliner Zeit.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { baueAntwortAnsicht, type AnsichtAbschnitt } from "../src/lib/anmeldung-antworten";
import {
  alterInJahren,
  beitragTeile,
  deutschesDatum,
  formalien,
  leseAbschnitte,
  sichtbareAntworten,
  teilnahmeLang,
} from "../src/lib/anmeldung-lesen";
import {
  abendStand,
  abendText,
  anwesenheitsStand,
  aufteilen,
  einheitVorbei,
  einladungEmpfohlenBis,
  eingangKurz,
  erfassungsText,
  gefaehrdungText,
  gefaehrdungTitel,
  kalendertag,
  kalendertageZwischen,
  namensListe,
  naechsterAbend,
  personStatusTon,
  ueberleitungFaellig,
  versaeumtKurz,
  wartetSeit,
  zeitraumText,
  zuletztZeilen,
} from "../src/lib/heute";

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

const WURZEL = process.cwd();
function lies(pfad: string): string {
  try {
    return readFileSync(join(WURZEL, pfad), "utf8");
  } catch {
    return "";
  }
}

// Örtliche Zeit (TZ=Europe/Berlin): Monat 0-basiert.
const berlin = (j: number, m: number, t: number, h = 12, min = 0) => new Date(j, m - 1, t, h, min);
const kalender = (j: number, m: number, t: number) => new Date(Date.UTC(j, m - 1, t));
const JETZT = berlin(2026, 9, 27, 12, 0); // Sonntag, 27.09.2026, mittags

console.log("\n1. Anwesenheit: wie oft nicht teilgenommen, und wie knapp es wird (20 Einheiten, 80 %)");
{
  const katharina = anwesenheitsStand(["ENTSCHULDIGT", "ENTSCHULDIGT", "ANWESEND"], 4, 20, 80);
  pruefe(
    "zweimal entschuldigt, noch zwei Einheiten Luft: gelb „2× entschuldigt“",
    katharina?.text === "2× entschuldigt" && katharina.ton === "gelb" && !katharina.gefaehrdet,
    katharina,
  );
  const viktor = anwesenheitsStand(["GEFEHLT", "GEFEHLT", "GEFEHLT"], 4, 20, 80);
  pruefe("dreimal gefehlt, nur noch eine Einheit Luft: rot „3× gefehlt“, gefährdet", viktor?.text === "3× gefehlt" && viktor.ton === "rot" && viktor.gefaehrdet, viktor);
  pruefe(
    "die Aufgabe auf „Heute“: „Viktor Neufeld: 3 von 4 Einheiten gefehlt“",
    viktor !== null && gefaehrdungTitel("Viktor Neufeld", viktor) === "Viktor Neufeld: 3 von 4 Einheiten gefehlt",
    viktor && gefaehrdungTitel("Viktor Neufeld", viktor),
  );
  pruefe(
    "… und was daraus folgt: „Darf nur noch einmal fehlen, sonst reicht es nicht für 80 %“ (geschütztes Leerzeichen)",
    viktor !== null && gefaehrdungText(viktor) === "Darf nur noch einmal fehlen, sonst reicht es nicht für 80 %",
    viktor && gefaehrdungText(viktor),
  );
  const harder = anwesenheitsStand(["ANWESEND", "ANWESEND", "ENTSCHULDIGT"], 4, 20, 80);
  pruefe("einmal entschuldigt bei drei Einheiten Luft: grün „im Soll“", harder?.text === "im Soll" && harder.ton === "gruen", harder);
  const wiebe = anwesenheitsStand(["NACHGEARBEITET", "GEFEHLT", "ANWESEND"], 4, 20, 80);
  pruefe("nachgearbeitet zählt als teilgenommen (einmal gefehlt: im Soll)", wiebe?.text === "im Soll" && wiebe.quote.teilgenommen === 2, wiebe);
  const gemischt = anwesenheitsStand(["GEFEHLT", "ENTSCHULDIGT"], 3, 20, 80);
  pruefe("gefehlt und entschuldigt zusammen: „2× versäumt“ (gelb)", gemischt?.text === "2× versäumt" && gemischt.ton === "gelb", gemischt);
  const alleDa = anwesenheitsStand(["ANWESEND", "ANWESEND"], 4, 20, 80);
  pruefe("unerfasste vergangene Einheiten zählen nicht gegen jemanden: „im Soll“", alleDa?.text === "im Soll" && alleDa.quote.offen === 18, alleDa);
  const unerreichbar = anwesenheitsStand(["GEFEHLT", "GEFEHLT", "GEFEHLT"], 3, 10, 80);
  pruefe(
    "nicht mehr erreichbar: rot, gefährdet, mit eigenem Satz",
    unerreichbar?.quote.zustand === "NICHT_ERREICHBAR" &&
      unerreichbar.ton === "rot" &&
      unerreichbar.gefaehrdet &&
      gefaehrdungText(unerreichbar) === "Die 80 % sind in diesem Semester nicht mehr erreichbar",
    unerreichbar,
  );
  const keinPuffer = anwesenheitsStand(["GEFEHLT", "GEFEHLT"], 3, 10, 80);
  pruefe(
    "kein Abend mehr Luft: „Darf nicht mehr fehlen …“",
    keinPuffer !== null && keinPuffer.gefaehrdet && gefaehrdungText(keinPuffer).startsWith("Darf nicht mehr fehlen"),
    keinPuffer,
  );
  const gesichert = anwesenheitsStand(["ANWESEND", "ANWESEND", "ANWESEND", "ANWESEND"], 4, 4, 80);
  pruefe("schon genug Teilnahmen: „erfüllt“", gesichert?.text === "erfüllt" && gesichert.ton === "gruen", gesichert);
  const kleinesSemester = anwesenheitsStand(["ANWESEND"], 1, 4, 80);
  pruefe(
    "ohne Fehltag nie gefährdet — auch wenn die Schwelle keinen Puffer lässt (4 Einheiten, 80 %)",
    kleinesSemester?.text === "im Soll" && !kleinesSemester.gefaehrdet,
    kleinesSemester,
  );
  pruefe("vor der ersten Einheit (oder ohne Einheiten) gibt es nichts zu sagen", anwesenheitsStand([], 0, 20, 80) === null && anwesenheitsStand([], 2, 0, 80) === null);
  pruefe(
    "Kurzform: nur gefehlt, nur entschuldigt, beides",
    versaeumtKurz(3, 0) === "3× gefehlt" && versaeumtKurz(0, 2) === "2× entschuldigt" && versaeumtKurz(1, 2) === "3× versäumt",
  );
  pruefe("„pauschal unter Soll“ gibt es nicht mehr", ![katharina, viktor, harder, alleDa].some((s) => s?.text.includes("unter Soll")));
}

console.log("\n2. Zeitangaben wie im Gespräch (Europe/Berlin)");
{
  pruefe("heute: „heute 08:12“", eingangKurz(berlin(2026, 9, 27, 8, 12), JETZT) === "heute 08:12", eingangKurz(berlin(2026, 9, 27, 8, 12), JETZT));
  pruefe("gestern: „gestern“", eingangKurz(berlin(2026, 9, 26, 11, 41), JETZT) === "gestern");
  pruefe("älter im selben Jahr: „Do., 24.09.“", eingangKurz(berlin(2026, 9, 24, 20, 5), JETZT) === "Do., 24.09.", eingangKurz(berlin(2026, 9, 24, 20, 5), JETZT));
  pruefe("aus einem anderen Jahr mit Jahreszahl", eingangKurz(berlin(2025, 9, 24, 20, 5), JETZT) === "24.09.2025");
  pruefe(
    "die Tagesgrenze ist Berliner Mitternacht (00:30 Uhr ist schon „heute“)",
    eingangKurz(new Date("2026-09-26T22:30:00.000Z"), JETZT) === "heute 00:30" && kalendertageZwischen(new Date("2026-09-26T21:59:00.000Z"), JETZT) === 1,
  );
  pruefe(
    "„wartet seit 3 Tagen“, „seit gestern“, „seit heute“",
    wartetSeit(berlin(2026, 9, 24, 20, 5), JETZT) === "wartet seit 3 Tagen" &&
      wartetSeit(berlin(2026, 9, 26, 9, 0), JETZT) === "wartet seit gestern" &&
      wartetSeit(berlin(2026, 9, 27, 8, 0), JETZT) === "wartet seit heute",
  );
  pruefe(
    "Namen: drei nebeneinander, danach „und N weitere“",
    namensListe(["Nelli Bergen", "Paul Dück", "Ruth Hamm"]) === "Nelli Bergen, Paul Dück, Ruth Hamm" &&
      namensListe(["A", "B", "C", "D", "E"]) === "A, B, C und 2 weitere",
  );
  const zwei = aufteilen([1, 2, 3], 2);
  const vier = aufteilen([1, 2, 3, 4], 2);
  pruefe(
    "Aufgaben: bis drei einzeln, ab vier zwei einzeln und eine Sammelzeile",
    zwei.einzeln.length === 3 && zwei.rest.length === 0 && vier.einzeln.join() === "1,2" && vier.rest.join() === "3,4",
  );
}

console.log("\n3. Abende eines Semesters und der nächste Unterricht");
{
  const tage = [
    [9, 15], [9, 22], [9, 29], [10, 6], [10, 27], [11, 3], [11, 10], [11, 17], [11, 24], [12, 1],
  ];
  const termine = tage.flatMap(([m, t]) => [
    { id: `${m}-${t}-bk`, beginn: berlin(2026, m, t, 19, 0), ende: berlin(2026, m, t, 20, 30) },
    { id: `${m}-${t}-kg`, beginn: berlin(2026, m, t, 20, 45), ende: berlin(2026, m, t, 21, 45) },
  ]);
  const stand = abendStand(termine, JETZT);
  pruefe("zwei Einheiten je Abend zählen als ein Abend: 10 Abende, 2 gehalten", stand.gesamt === 10 && stand.gehalten === 2, stand);
  pruefe("„Abend 2 von 10 gehalten“", abendText(stand) === "Abend 2 von 10 gehalten", abendText(stand));
  pruefe("alle Abende an einem Dienstag: „dienstags“ (auch über die Zeitumstellung)", stand.wochentag === "dienstags", stand.wochentag);
  pruefe("der letzte Abend ist der 01.12.", stand.letzterAbend !== null && stand.letzterAbend.getTime() === berlin(2026, 12, 1, 20, 45).getTime());
  pruefe(
    "vorher „10 Abende geplant“, am Ende „Alle 10 Abende gehalten“",
    abendText(abendStand(termine, berlin(2026, 9, 1))) === "10 Abende geplant" &&
      abendText(abendStand(termine, berlin(2026, 12, 2))) === "Alle 10 Abende gehalten",
  );
  pruefe(
    "Zeitraum: „15.09. bis 01.12.2026, dienstags“",
    zeitraumText(kalender(2026, 9, 15), kalender(2026, 12, 1), "dienstags") === "15.09. bis 01.12.2026, dienstags",
    zeitraumText(kalender(2026, 9, 15), kalender(2026, 12, 1), "dienstags"),
  );
  pruefe("über den Jahreswechsel mit beiden Jahreszahlen", zeitraumText(kalender(2026, 12, 1), kalender(2027, 2, 16), null) === "01.12.2026 bis 16.02.2027");
  const naechster = naechsterAbend(termine, JETZT);
  pruefe("nächster Unterricht: beide Einheiten am 29.09.", naechster.map((t) => t.id).join() === "9-29-bk,9-29-kg", naechster.map((t) => t.id));
  pruefe(
    "während des Abends bleibt er der nächste (20:00 Uhr: beide Einheiten)",
    naechsterAbend(termine, berlin(2026, 9, 29, 20, 0)).map((t) => t.id).join() === "9-29-bk,9-29-kg",
  );
  pruefe("nach der letzten Einheit ist es der nächste Dienstag", naechsterAbend(termine, berlin(2026, 9, 29, 22, 0))[0]?.id === "10-6-bk");
  pruefe("nach dem Semester gibt es keinen", naechsterAbend(termine, berlin(2026, 12, 2)).length === 0);
  pruefe(
    "eine Einheit ist vorbei, wenn ihr Ende erreicht ist (ohne Ende: ihr Beginn)",
    !einheitVorbei(berlin(2026, 9, 29, 19), berlin(2026, 9, 29, 20, 30), berlin(2026, 9, 29, 20)) &&
      einheitVorbei(berlin(2026, 9, 29, 19), berlin(2026, 9, 29, 20, 30), berlin(2026, 9, 29, 20, 30)) &&
      einheitVorbei(berlin(2026, 9, 29, 19), null, berlin(2026, 9, 29, 19)),
  );
  pruefe(
    "Erfassung: selbst eingetragen, teils erfasst, noch niemand",
    erfassungsText(5, 20, 5) === "5 von 20 haben sich schon selbst eingetragen" &&
      erfassungsText(1, 20, 1) === "1 von 20 hat sich schon selbst eingetragen" &&
      erfassungsText(12, 20, 5) === "12 von 20 erfasst" &&
      erfassungsText(0, 20, 0) === "noch niemand erfasst",
  );
}

console.log("\n4. Semesterüberleitung: bis wann einladen?");
{
  const start = kalender(2027, 2, 16);
  pruefe(
    "empfohlen bis zur ersten Erinnerung (14 Tage vorher): 02.02.",
    kalendertag(einladungEmpfohlenBis(start, 14), false) === "02.02.",
    kalendertag(einladungEmpfohlenBis(start, 14), false),
  );
  const faellig = (jetzt: Date, gestartet = false) => ueberleitungFaellig({ start, gestartet, jetzt, ersteErinnerungTage: 14 });
  pruefe("im September ist sie noch keine Aufgabe", !faellig(JETZT));
  pruefe("zwei Wochen vor dem empfohlenen Tag wird sie eine (19.01.)", !faellig(berlin(2027, 1, 18)) && faellig(berlin(2027, 1, 19)));
  pruefe("nach dem empfohlenen Tag bleibt sie es bis zum Vortag des Beginns", faellig(berlin(2027, 2, 15, 23, 30)) && !faellig(berlin(2027, 2, 16, 0, 30)));
  pruefe("gestartet ist sie keine Aufgabe mehr", !faellig(berlin(2027, 1, 25), true));
}

console.log("\n5. Personenstatus als Status-Punkt");
pruefe(
  "Aktiv leise (ohne Punkt), Angenommen blau, Beurlaubt gelb, Ausgeschlossen rot, Unbekanntes grau",
  personStatusTon("AKTIV") === null &&
    personStatusTon("ANGENOMMEN") === "blau" &&
    personStatusTon("BEURLAUBT") === "gelb" &&
    personStatusTon("AUSGESCHLOSSEN") === "rot" &&
    personStatusTon("INTERESSENT") === "grau" &&
    personStatusTon("WAS_NEUES") === "grau",
);

console.log("\n6. „Zuletzt“: Protokolleinträge als Sätze");
{
  const einheit = berlin(2026, 9, 22, 19, 0);
  const zeilen = zuletztZeilen([
    ...["a", "b", "c", "d", "e", "a"].map((person, i) => ({ art: "selbst" as const, am: berlin(2026, 9, 23, 7, 40 + i), person, einheit })),
    { art: "erfasst", am: berlin(2026, 9, 15, 21, 0), einheit: berlin(2026, 9, 15, 19, 0), von: "Markus Tiessen" },
    { art: "erfasst", am: berlin(2026, 9, 15, 21, 55), einheit: berlin(2026, 9, 15, 20, 45), von: "Markus Tiessen" },
    { art: "aufgenommen", am: berlin(2026, 9, 11, 9, 20), name: "Lydia Fast" },
    { art: "status", am: berlin(2026, 9, 8, 18, 20), name: "Maria Braun", status: "Beurlaubt" },
    { art: "ueberleitung", am: berlin(2026, 9, 1, 10, 0), semester: "Frühlingssemester 2027" },
  ]);
  pruefe(
    "Selbstbestätigungen je Abend zusammengefasst, jede Person einmal",
    zeilen[0]?.text === "5 Teilnehmer haben den Abend vom 22.09. selbst bestätigt",
    zeilen[0],
  );
  pruefe("Erfassungen je Abend und Person zusammengefasst", zeilen[1]?.text === "Anwesenheit vom 15.09. erfasst (Markus Tiessen)", zeilen[1]);
  pruefe(
    "neueste zuerst, höchstens vier Zeilen",
    zeilen.length === 4 && zeilen[2]?.text === "Lydia Fast aufgenommen" && zeilen[3]?.text === "Maria Braun: Status „Beurlaubt“",
    zeilen.map((z) => z.text),
  );
  pruefe(
    "Ablehnung und Überleitung in eigenen Worten",
    zuletztZeilen([
      { art: "abgelehnt", am: JETZT, name: "Bruno Bewerber" },
      { art: "ueberleitung", am: berlin(2026, 9, 1), semester: "Frühlingssemester 2027" },
    ])
      .map((z) => z.text)
      .join("|") === "Anmeldung von Bruno Bewerber abgelehnt|Einladung ins Frühlingssemester 2027 gestartet",
  );
}

console.log("\n7. Die Lesefassung einer Anmeldung");
{
  const FORMULAR: AnsichtAbschnitt[] = [
    {
      titel: "Persönliche Daten",
      felder: [
        { code: "vorname", typ: "TEXT", label: "Vorname", istArt9: false },
        { code: "nachname", typ: "TEXT", label: "Nachname", istArt9: false },
        { code: "geburtsdatum", typ: "DATUM", label: "Geburtsdatum", istArt9: false },
        { code: "strasse", typ: "TEXT", label: "Straße und Hausnummer", istArt9: false },
        { code: "plz", typ: "TEXT", label: "PLZ", istArt9: false },
        { code: "ort", typ: "TEXT", label: "Ort", istArt9: false },
        { code: "email", typ: "EMAIL", label: "E-Mail", istArt9: false },
        { code: "telefon", typ: "TELEFON", label: "Telefon", istArt9: false },
        { code: "familienstand", typ: "AUSWAHL_EINFACH", label: "Familienstand", istArt9: false },
        { code: "ehepartner_gemeinsam", typ: "JA_NEIN", label: "Gemeinsam mit Ehepartner", istArt9: false },
      ],
    },
    {
      titel: "Bildung & Beruf",
      felder: [
        { code: "schulabschluss", typ: "AUSWAHL_EINFACH", label: "Höchster Schulabschluss", istArt9: false },
        { code: "erlernter_beruf", typ: "TEXT", label: "Erlernter Beruf", istArt9: false },
        { code: "derzeitiger_beruf", typ: "TEXT", label: "Derzeitiger Beruf", istArt9: false },
      ],
    },
    {
      titel: "Werdegang und Hintergrund",
      felder: [
        { code: "glaube_bekenntnis", typ: "MEHRZEILIG", label: "Glauben Sie …?", istArt9: true },
        { code: "glaube_werdegang", typ: "MEHRZEILIG", label: "Wie kamen Sie zum Glauben?", istArt9: true },
        { code: "gemeinde_mitglied", typ: "TEXT", label: "Gemeinde", istArt9: true },
        { code: "gemeinde_aktuell", typ: "TEXT", label: "Gemeinde zurzeit", istArt9: true },
        { code: "gemeinde_beteiligung", typ: "MEHRZEILIG", label: "Beteiligung", istArt9: true },
        { code: "dienst_erfahrung", typ: "MEHRZEILIG", label: "Dienst", istArt9: true },
        { code: "motivation", typ: "MEHRZEILIG", label: "Was motiviert Sie?", istArt9: true },
        { code: "ziele", typ: "MEHRZEILIG", label: "Ihre Ziele", istArt9: true },
        { code: "gebetsanliegen", typ: "MEHRZEILIG", label: "Wofür dürfen wir beten?", istArt9: true },
      ],
    },
    {
      titel: "Bankverbindung",
      felder: [
        { code: "kontoinhaber", typ: "TEXT", label: "Kontoinhaber", istArt9: false },
        { code: "iban", typ: "IBAN", label: "IBAN", istArt9: false, personFeld: "IBAN" },
        { code: "einzug_einverstanden", typ: "JA_NEIN", label: "Einzug", istArt9: false },
        { code: "zahlweise", typ: "AUSWAHL_EINFACH", label: "Zahlweise", istArt9: false },
      ],
    },
  ];
  const ANTWORTEN: Record<string, unknown> = {
    vorname: "Ruth",
    nachname: "Hamm",
    geburtsdatum: "1985-12-09",
    strasse: "Kurstraße 9",
    plz: "32545",
    ort: "Bad Oeynhausen",
    email: "ruth.hamm@example.org",
    telefon: "030 23125 343",
    familienstand: "",
    schulabschluss: "Realschulabschluss",
    erlernter_beruf: "Pflegefachfrau",
    derzeitiger_beruf: "Pflegefachfrau",
    glaube_bekenntnis: "Ja, ich glaube an Jesus Christus als meinen Herrn.",
    glaube_werdegang: "Christlich aufgewachsen, mit 17 bewusst entschieden und getauft.",
    gemeinde_mitglied: "Gemeinde Bad Oeynhausen-Süd",
    gemeinde_beteiligung: "Hauskreis und Kinderstunde, etwa zweimal im Monat.",
    dienst_erfahrung: "Mitarbeit in der Jugend und im Lobpreis.",
    motivation: "Unsere Gemeinde sucht Mitarbeiter für den Bibelunterricht.",
    ziele: "Die Bibel im Zusammenhang verstehen.",
    gebetsanliegen: "Für die Familie.",
    kontoinhaber: "Ruth Hamm",
    iban: "DE33 3704 0044 0007 7777 02",
    einzug_einverstanden: true,
    zahlweise: "Halbjährlich",
  };
  const art9 = new Set(FORMULAR.flatMap((a) => a.felder).filter((f) => f.istArt9).map((f) => f.code));
  const sichtbar = sichtbareAntworten(baueAntwortAnsicht(FORMULAR, ANTWORTEN, true));
  const verborgen = sichtbareAntworten(baueAntwortAnsicht(FORMULAR, ANTWORTEN, false));
  const abschnitte = leseAbschnitte(sichtbar, art9);

  pruefe(
    "Reihenfolge: Motivation, Ziel, Glaube, Gemeinde und Dienst — Unbekanntes unter „Weitere Angaben“",
    abschnitte.map((a) => a.titel).join("|") === "Motivation|Ziel|Glaube|Gemeinde und Dienst|Weitere Angaben",
    abschnitte.map((a) => a.titel),
  );
  const gemeinde = abschnitte.find((a) => a.titel === "Gemeinde und Dienst");
  pruefe(
    "leere Antworten fehlen, mehrdeutige tragen einen kurzen Vorsatz",
    gemeinde?.eintraege.map((e) => e.vorsatz).join("|") === "Mitglied|Im Gemeindeleben|Erfahrung im Dienst",
    gemeinde,
  );
  pruefe(
    "eine Art.-9-Frage ohne Überschrift steht mit ihrer Frage unter „Weitere Angaben“",
    abschnitte.at(-1)?.eintraege[0]?.vorsatz === "Wofür dürfen wir beten?" && abschnitte.at(-1)?.eintraege[0]?.text === "Für die Familie.",
  );
  pruefe(
    "ohne Freigabe erscheint keine Art.-9-Antwort — auch nicht in der Lesefassung",
    leseAbschnitte(verborgen, art9).length === 0 && !verborgen.has("motivation") && !JSON.stringify([...verborgen]).includes("Bibelunterricht"),
  );
  pruefe(
    "die IBAN steht nie in den Antworten (auch wenn sie im Antwortbogen steckt)",
    !sichtbar.has("iban") && !JSON.stringify([...sichtbar]).includes("DE33"),
  );
  const formal = formalien(sichtbar);
  pruefe(
    "Formalien kompakt: Beruf ohne Doppelung, Kontakt, Adresse — ohne leeren Familienstand",
    formal.map((f) => `${f.label}=${f.wert}`).join("|") ===
      "Beruf=Pflegefachfrau · Realschulabschluss|Kontakt=ruth.hamm@example.org · 030 23125 343|Adresse=Kurstraße 9, 32545 Bad Oeynhausen",
    formal,
  );
  const umgelernt = sichtbareAntworten(baueAntwortAnsicht(FORMULAR, { ...ANTWORTEN, erlernter_beruf: "Schreiner", derzeitiger_beruf: "Tischler" }, true));
  pruefe("ein anderer erlernter Beruf wird genannt", formalien(umgelernt)[0]?.wert === "Tischler · gelernt: Schreiner · Realschulabschluss", formalien(umgelernt)[0]);
  pruefe(
    "Beitrag: „Einzug erlaubt“, „halbjährlich“",
    beitragTeile(sichtbar, "Ruth Hamm").join(" · ") === "Einzug erlaubt · halbjährlich",
    beitragTeile(sichtbar, "Ruth Hamm"),
  );
  const mitPartner = sichtbareAntworten(
    baueAntwortAnsicht(FORMULAR, { ...ANTWORTEN, kontoinhaber: "Peter Hamm", ehepartner_gemeinsam: true, familienstand: "Verheiratet" }, true),
  );
  pruefe(
    "abweichender Kontoinhaber und gemeinsame Anmeldung werden genannt, der Familienstand auch",
    beitragTeile(mitPartner, "Ruth Hamm").join(" · ") === "Einzug erlaubt · halbjährlich · Konto von Peter Hamm · gemeinsam mit dem Ehepartner angemeldet" &&
      formalien(mitPartner).some((f) => f.label === "Familie" && f.wert === "Verheiratet"),
    beitragTeile(mitPartner, "Ruth Hamm"),
  );
  pruefe(
    "Datum deutsch (nicht 1985-12-09); anderes bleibt, wie es ist",
    deutschesDatum("1985-12-09") === "09.12.1985" && deutschesDatum("2026-02-31") === "2026-02-31" && deutschesDatum("gestern") === "gestern",
  );
  pruefe(
    "Alter in ganzen Jahren, am Geburtstag gezählt",
    alterInJahren(kalender(1985, 12, 9), JETZT) === 40 &&
      alterInJahren(kalender(1986, 9, 27), JETZT) === 40 &&
      alterInJahren(kalender(1986, 9, 28), JETZT) === 39,
  );
  pruefe("Teilnahme ausgeschrieben", teilnahmeLang("SCHUELER") === "Schüler, mit Prüfungen" && teilnahmeLang("HOERER") === "Hörer, ohne Prüfungen" && teilnahmeLang(null) === "");
}

console.log("\n8. Quelltext: wo der Datenschutz hängt");
{
  const liste = lies("src/app/verwaltung/anmeldungen/anmeldungs-liste.tsx");
  pruefe(
    "die Anmeldeliste lädt keine Antworten (Art. 9) und lädt die Einzelansicht nicht vor",
    liste.includes("ladeAnmeldungsListe") && !/antworten:\s*true/.test(liste) && /prefetch=\{false\}/.test(liste),
  );
  const einzel = lies("src/app/verwaltung/anmeldungen/[id]/page.tsx");
  pruefe(
    "die Lesefassung entsteht aus der geschützten Antwortansicht, und jeder Abruf wird protokolliert",
    einzel.includes("sichtbareAntworten(ansicht)") && einzel.includes('aktion: "ANMELDUNG_ANTWORTEN_ANGESEHEN"'),
  );
  const heute = lies("src/app/verwaltung/page.tsx");
  pruefe(
    "„Zuletzt“ nennt Entscheidungen über Anmeldungen nur mit ANMELDUNG_LESEN, und nur mit AUDIT_LESEN",
    heute.includes('...(darf.anmeldungen ? ["ANMELDUNG_ANGENOMMEN", "ANMELDUNG_ABGELEHNT"] : [])') &&
      heute.includes("darf.audit ? await ladeZuletzt(darf, jetzt) : []"),
  );
  pruefe(
    "die Weiterleitungen für reine Dozenten und Teilnehmer bleiben",
    heute.includes('redirect("/dozent")') && heute.includes('redirect("/meine-daten")'),
  );
}

// Soll-Anzahl: fängt lautlos entfallene Prüfungen ab. Beim Ergänzen anheben.
const ERWARTET = 63;
const gelaufen = geprueft + 1;
pruefe(`alle ${ERWARTET} Prüfungen sind gelaufen`, gelaufen === ERWARTET, gelaufen);

console.log(`\n${geprueft} Prüfungen, ${fehlgeschlagen} fehlgeschlagen.\n`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);

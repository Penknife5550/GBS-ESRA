/**
 * GBS Campus — Grunddaten
 *
 * Idempotent: laeuft bei jedem Start des App-Containers und legt nur an, was
 * fehlt. Bestehende Datensaetze werden aktualisiert, nicht dupliziert.
 * Ausnahmen — nur anlegen, nie ueberschreiben: Einwilligungstexte (Nachweis;
 * an einer abgeloesten Fassung setzt der Seed nur `aktivBis`), Semester
 * (gehoeren nach dem Erststart dem Betrieb), das Anmeldeformular und die Werte
 * der Einstellungen.
 *
 * Was hier steht, ist bewusst KEINE Konfiguration im Code: Status, Rollen und
 * Rechte liegen als Daten in der Datenbank und lassen sich ohne Deploy
 * erweitern. Der Seed setzt nur den Ausgangsstand.
 */

import { PrismaClient } from "@prisma/client";
import { RECHT } from "../src/lib/constants";
import { EINSTELLUNGEN } from "../src/lib/einstellungen";
import { HONORAR_SATZ_FALLBACK } from "../src/lib/honorar";
import { ABSCHNITTE, EINLEITUNG } from "./anmeldeformular-definition";
import { FAECHER, KURSEINHEITEN } from "./kursraster-definition";

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Statusmaschine (1_Bauplan.html Kap. 05)
// -----------------------------------------------------------------------------
const STATUS = [
  {
    code: "INTERESSENT",
    bezeichnung: "Interessent",
    beschreibung: "Anmeldung eingegangen, noch nicht entschieden.",
    istAktiv: false,
    istTerminal: false,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: true,
    sortierung: 10,
  },
  {
    code: "ANGENOMMEN",
    bezeichnung: "Angenommen",
    beschreibung: "Aufnahme bestaetigt, Akte angelegt, Semesterstart steht noch aus.",
    istAktiv: true,
    istTerminal: false,
    beitragLaeuft: true,
    anwesenheitZaehlt: false,
    automatikMails: true,
    sortierung: 20,
  },
  {
    code: "AKTIV",
    bezeichnung: "Aktiv",
    beschreibung: "Nimmt am laufenden Semester teil — als Schueler oder als Hoerer.",
    istAktiv: true,
    istTerminal: false,
    beitragLaeuft: true,
    anwesenheitZaehlt: true,
    automatikMails: true,
    sortierung: 30,
  },
  {
    code: "BEURLAUBT",
    bezeichnung: "Beurlaubt",
    beschreibung: "Pausiert. Beitrag ruht, die Anwesenheits-Uhr steht. Regeln siehe E-13.",
    istAktiv: false,
    istTerminal: false,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: true,
    sortierung: 40,
  },
  {
    code: "ABSOLVENT",
    bezeichnung: "Absolvent",
    // Kein Endzustand (Code-Review 4, Fachentscheidung): Absolventen behalten
    // den Portalzugang — sonst kämen sie nicht mehr an ihr Abschlusszeugnis.
    // Sie zählen aber nicht als aktiv und bekommen keine Automatik-Mails
    // (Überleitung, Erinnerungen).
    beschreibung: "Ausbildung abgeschlossen. Zugang zum Portal bleibt, keine automatischen Mails.",
    istAktiv: false,
    istTerminal: false,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: false,
    sortierung: 50,
  },
  {
    code: "ABGEBROCHEN",
    bezeichnung: "Abgebrochen",
    beschreibung:
      "Freiwillig ausgestiegen. Der Beitragslauf stoppt, es gehen keine automatischen Mails mehr. " +
      "Kein Endzustand: Die Schulleitung kann die Person mit Grund wieder aufnehmen.",
    // Kein Endzustand (Empfehlung Semesterbetrieb, 27.09.2026): Wer eine Pause
    // einlegt oder später zurückkommt, soll wieder aufgenommen werden können —
    // der Bauplan sieht den Wiedereinstieg ausdrücklich vor. Wie ABSOLVENT:
    // nicht aktiv, keine Automatik-Mails, der Portalzugang bleibt. Endzustände
    // bleiben AUSGESCHLOSSEN, VERSTORBEN und ANONYMISIERT.
    istAktiv: false,
    istTerminal: false,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: false,
    sortierung: 60,
  },
  {
    code: "AUSGESCHLOSSEN",
    bezeichnung: "Ausgeschlossen",
    beschreibung: "Bisher nie genutzt, laut Interview aber vorzusehen.",
    istAktiv: false,
    istTerminal: true,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: false,
    sortierung: 70,
  },
  {
    code: "VERSTORBEN",
    bezeichnung: "Verstorben",
    // Harter Not-Aus: alle Automatik-Schalter aus. Verhindert, dass Beitrags-,
    // Mahn- oder Erinnerungslaeufe Hinterbliebene erreichen.
    beschreibung: "Not-Aus fuer jede Automatik. Kein Beitrag, keine automatischen Mails.",
    istAktiv: false,
    istTerminal: true,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: false,
    sortierung: 80,
  },
  {
    code: "ANONYMISIERT",
    bezeichnung: "Anonymisiert",
    // DSGVO Art. 17: Der Datensatz bleibt (Audit- und Einwilligungsnachweis sind
    // append-only und muessen erhalten bleiben), aber alle personenbezogenen
    // Felder sind ueberschrieben. Endzustand, jede Automatik aus.
    beschreibung: "Personenbezogene Daten geloescht (anonymisiert nach Art. 17 DSGVO). Endzustand.",
    istAktiv: false,
    istTerminal: true,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: false,
    sortierung: 90,
  },
];

// -----------------------------------------------------------------------------
// Rechte (1_Bauplan.html Kap. 04)
//
// Die Codes kommen aus RECHT (src/lib/constants.ts): Ein vertippter Code ist so
// ein Compile-Fehler statt lautlosem Rechteentzug, und
// scripts/pruefe-benutzerverwaltung.ts gleicht diese Liste in beide Richtungen
// mit RECHT ab. Vier Rechte prueft heute noch keine Route
// (MAIL_VERTEILER_SENDEN, MAIL_VORLAGEN_BEARBEITEN, FINANZ_DATEN_LESEN,
// IMPERSONATION) — ihre Bezeichnung sagt das. Ob sie entfallen, ist eine
// Rollenentscheidung.
// -----------------------------------------------------------------------------
const RECHTE = [
  { code: RECHT.PERSON_LESEN_EIGENE, bezeichnung: "Eigene Daten sehen", bereich: "PERSON" },
  { code: RECHT.PERSON_BEARBEITEN_EIGENE, bezeichnung: "Eigene Daten aendern", bereich: "PERSON" },
  { code: RECHT.PERSON_LESEN_ALLE, bezeichnung: "Alle Personen sehen", bereich: "PERSON" },
  { code: RECHT.PERSON_BEARBEITEN_ALLE, bezeichnung: "Stammdaten aller Personen aendern", bereich: "PERSON" },
  { code: RECHT.PERSON_STATUS_WECHSELN, bezeichnung: "Teilnehmerstatus aendern", bereich: "PERSON" },
  { code: RECHT.PERSON_EXPORTIEREN, bezeichnung: "Teilnehmerliste exportieren", bereich: "PERSON" },
  { code: RECHT.PERSON_ANONYMISIEREN, bezeichnung: "Person anonymisieren (Löschung nach Art. 17 DSGVO)", bereich: "PERSON" },
  { code: RECHT.SEMESTER_VERWALTEN, bezeichnung: "Semester anlegen und das laufende festlegen", bereich: "PERSON" },
  // Release 0.3 — Dozenten-Self-Service: der Dozent sieht seine eigenen Abende
  // (read-only) und erfasst die Anwesenheit der EIGENEN Abende an der Quelle.
  // Der eigentliche Schutz ist der Scope-Guard termin.dozentId === eigene Id;
  // das Recht oeffnet nur die Tuer. GASTDOZENT bleibt bewusst rechtlos (Token-Flow).
  { code: RECHT.EIGENE_TERMINE_LESEN, bezeichnung: "Eigene Unterrichtsabende sehen", bereich: "UNTERRICHT" },
  { code: RECHT.ANWESENHEIT_ERFASSEN_EIGENE, bezeichnung: "Anwesenheit der eigenen Abende erfassen", bereich: "UNTERRICHT" },
  // Release 0.4 — Noten Stufe 1. Der Dozent bewertet nur seine EIGENEN
  // Kurseinheiten (Scope-Guard: es existiert ein eigener Abend zu Kurseinheit und
  // Semester); die Schulleitung verwaltet alle Fächer. Bewusst NICHT bei der
  // Verwaltung — Noten sind eine paedagogische Entscheidung (wie PERSON_ANONYMISIEREN).
  { code: RECHT.NOTEN_ERFASSEN_EIGENE, bezeichnung: "Noten der eigenen Kurseinheiten erfassen", bereich: "UNTERRICHT" },
  { code: RECHT.NOTEN_VERWALTEN, bezeichnung: "Noten aller Fächer verwalten", bereich: "UNTERRICHT" },
  { code: RECHT.ANMELDUNG_LESEN, bezeichnung: "Anmeldungen einsehen", bereich: "ANMELDUNG" },
  { code: RECHT.ANMELDUNG_ENTSCHEIDEN, bezeichnung: "Anmeldungen annehmen oder ablehnen", bereich: "ANMELDUNG" },
  { code: RECHT.FORMULAR_BEARBEITEN, bezeichnung: "Anmeldeformulare gestalten", bereich: "ANMELDUNG" },
  { code: RECHT.FORMULAR_VEROEFFENTLICHEN, bezeichnung: "Formularfassung veroeffentlichen", bereich: "ANMELDUNG" },
  { code: RECHT.MAIL_VERTEILER_SENDEN, bezeichnung: "Rundmail an einen Verteiler senden (noch ohne Funktion)", bereich: "KOMMUNIKATION" },
  { code: RECHT.MAIL_VORLAGEN_BEARBEITEN, bezeichnung: "E-Mail-Vorlagen bearbeiten (noch ohne Funktion)", bereich: "KOMMUNIKATION" },
  { code: RECHT.FINANZ_DATEN_LESEN, bezeichnung: "Beitragsstatus sehen (noch ohne Funktion)", bereich: "FINANZEN" },
  // Bewusst getrennt vom Beitragsstatus: die IBAN sieht nur, wer sie zum
  // Arbeiten braucht (Datenminimierung, DSGVO Art. 5 Abs. 1 lit. c).
  { code: RECHT.BANKVERBINDUNG_LESEN, bezeichnung: "Bankverbindung sehen", bereich: "FINANZEN" },
  // Read-only ab Release 0.2: Anzahl gehaltener Abende je Dozent x Honorarsatz.
  { code: RECHT.HONORAR_LESEN, bezeichnung: "Honorarübersicht der Dozenten sehen", bereich: "FINANZEN" },
  // Release 0.3: einen Honorarsatz mit Gueltig-ab-Datum genehmigen. Das Eintragen
  // ist die Genehmigung; danach geht ein Beleg an das DMS.
  { code: RECHT.HONORAR_SATZ_GENEHMIGEN, bezeichnung: "Honorarsatz genehmigen", bereich: "FINANZEN" },
  // Release 0.3: Honorar-Abrechnungen erstellen, freigeben und als ausgezahlt
  // markieren. Die Freigabe (Beleg mit IBAN ans DMS) verlangt zusaetzlich
  // BANKVERBINDUNG_LESEN — geprueft in der Route.
  { code: RECHT.HONORAR_ABRECHNEN, bezeichnung: "Honorar abrechnen und auszahlen", bereich: "FINANZEN" },
  { code: RECHT.BENUTZER_VERWALTEN, bezeichnung: "Konten und Rollen verwalten", bereich: "SYSTEM" },
  { code: RECHT.SYSTEM_EINSTELLUNGEN, bezeichnung: "Systemeinstellungen aendern", bereich: "SYSTEM" },
  { code: RECHT.AUDIT_LESEN, bezeichnung: "Audit-Log lesen", bereich: "SYSTEM" },
  { code: RECHT.IMPERSONATION, bezeichnung: "Sicht einer anderen Person einnehmen (noch ohne Funktion)", bereich: "SYSTEM" },
];

// -----------------------------------------------------------------------------
// Rollen und ihre Rechte
// -----------------------------------------------------------------------------
const ROLLEN = [
  {
    code: "ADMIN",
    bezeichnung: "Administrator",
    beschreibung: "Technisch verantwortlich. Trifft ausdruecklich keine fachlichen Entscheidungen.",
    aktivAbRelease: "0.1",
    sortierung: 10,
    rechte: [
      RECHT.BENUTZER_VERWALTEN,
      RECHT.SYSTEM_EINSTELLUNGEN,
      RECHT.AUDIT_LESEN,
      RECHT.IMPERSONATION,
      RECHT.PERSON_LESEN_ALLE,
      RECHT.MAIL_VORLAGEN_BEARBEITEN,
      RECHT.PERSON_LESEN_EIGENE,
      RECHT.PERSON_BEARBEITEN_EIGENE,
    ],
  },
  {
    code: "SCHULLEITER",
    bezeichnung: "Schulleiter",
    beschreibung: "Fachliche Vollverantwortung.",
    aktivAbRelease: "0.1",
    sortierung: 20,
    rechte: [
      RECHT.PERSON_LESEN_ALLE,
      RECHT.PERSON_BEARBEITEN_ALLE,
      RECHT.PERSON_STATUS_WECHSELN,
      RECHT.PERSON_EXPORTIEREN,
      // Die Anonymisierung (Art. 17 DSGVO) ist eine schwerwiegende, endgueltige
      // Entscheidung — sie liegt bei der Schulleitung, nicht bei der Verwaltung.
      RECHT.PERSON_ANONYMISIEREN,
      RECHT.SEMESTER_VERWALTEN,
      // Noten aller Fächer — paedagogische Entscheidung, bewusst nur hier (nicht
      // bei der Verwaltung).
      RECHT.NOTEN_VERWALTEN,
      RECHT.ANMELDUNG_LESEN,
      RECHT.ANMELDUNG_ENTSCHEIDEN,
      RECHT.FORMULAR_BEARBEITEN,
      RECHT.FORMULAR_VEROEFFENTLICHEN,
      RECHT.MAIL_VERTEILER_SENDEN,
      RECHT.MAIL_VORLAGEN_BEARBEITEN,
      RECHT.FINANZ_DATEN_LESEN,
      RECHT.HONORAR_LESEN,
      RECHT.HONORAR_SATZ_GENEHMIGEN,
      RECHT.HONORAR_ABRECHNEN,
      // Ohne dieses Recht sähe die Schulleitung die Protokollansicht nicht — und
      // genau die Vorgänge dort sind ihre: Meldungen aus dem Hilfeformular,
      // Adressänderungen an fremden Konten, fehlgeschlagene Anmeldeversuche.
      // Bei Bus-Faktor 1 darf das nicht an einem einzigen Konto hängen.
      RECHT.AUDIT_LESEN,
      RECHT.PERSON_LESEN_EIGENE,
      RECHT.PERSON_BEARBEITEN_EIGENE,
    ],
  },
  {
    code: "VERWALTUNG",
    bezeichnung: "Verwaltung",
    beschreibung: "Finanzen und Stammdaten. Keine paedagogischen Entscheidungen.",
    aktivAbRelease: "0.1",
    sortierung: 30,
    rechte: [
      RECHT.PERSON_LESEN_ALLE,
      RECHT.PERSON_BEARBEITEN_ALLE,
      RECHT.PERSON_EXPORTIEREN,
      RECHT.SEMESTER_VERWALTEN,
      RECHT.ANMELDUNG_LESEN,
      RECHT.FINANZ_DATEN_LESEN,
      RECHT.BANKVERBINDUNG_LESEN,
      RECHT.HONORAR_LESEN,
      RECHT.HONORAR_SATZ_GENEHMIGEN,
      RECHT.HONORAR_ABRECHNEN,
      RECHT.MAIL_VERTEILER_SENDEN,
      RECHT.PERSON_LESEN_EIGENE,
      RECHT.PERSON_BEARBEITEN_EIGENE,
    ],
  },
  {
    code: "TEILNEHMER",
    bezeichnung: "Teilnehmer",
    beschreibung: "Schueler oder Hoerer. Sieht ausschliesslich die eigenen Daten.",
    aktivAbRelease: "0.1",
    sortierung: 40,
    rechte: [RECHT.PERSON_LESEN_EIGENE, RECHT.PERSON_BEARBEITEN_EIGENE],
  },
  {
    code: "DOZENT",
    bezeichnung: "Dozent",
    beschreibung: "Verantwortet einen ganzen Kurs. Rechte sind auf das eigene Fach begrenzt.",
    aktivAbRelease: "0.2",
    sortierung: 50,
    rechte: [
      RECHT.PERSON_LESEN_EIGENE,
      RECHT.PERSON_BEARBEITEN_EIGENE,
      RECHT.EIGENE_TERMINE_LESEN,
      RECHT.ANWESENHEIT_ERFASSEN_EIGENE,
      RECHT.NOTEN_ERFASSEN_EIGENE,
    ],
  },
  {
    code: "GASTDOZENT",
    bezeichnung: "Gastdozent",
    beschreibung: "Einzelne Unterrichtseinheiten. Arbeitet ueber einen Token-Link ohne Login.",
    aktivAbRelease: "0.2",
    sortierung: 60,
    rechte: [],
  },
];

// -----------------------------------------------------------------------------
// Einwilligungstexte
//
// Eine Fassung ist nach dem Anlegen eingefroren (Trigger, Migration
// 20260927100000_einwilligungstexte_unveraenderlich), denn erteilte
// Einwilligungen verweisen auf genau ihre Fassung. Ein geaenderter Text ist
// deshalb immer ein neuer Eintrag mit version + 1; die abgeloesten Fassungen
// bleiben hier stehen, damit ihr Wortlaut (Nachweis nach Art. 7 Abs. 1 DSGVO)
// auch im Code nachlesbar bleibt. Angeboten wird je Code die hoechste gueltige
// Fassung (`ladeEinwilligungstexte`); die aelteren setzt main() ueber
// `aktivBis` ausser Kraft.
// -----------------------------------------------------------------------------
const EINWILLIGUNGEN = [
  // Fassung 1 (Release 0.1) — abgeloest durch Fassung 2. Bleibt unveraendert
  // stehen: Die bis dahin erteilten Einwilligungen zeigen auf sie und bleiben
  // wirksam.
  {
    code: "DATENSCHUTZ",
    version: 1,
    titel: "Verarbeitung meiner Daten zur Durchführung der Ausbildung",
    istArt9: false,
    pflicht: true,
    text:
      "Ich willige ein, dass das Christliche Werk Esra e.V. meine im Anmeldeformular " +
      "angegebenen Daten zum Zweck der Durchführung und Verwaltung der Ausbildung an " +
      "der Gemeindebibelschule Minden verarbeitet. Die Einwilligung kann ich jederzeit " +
      "mit Wirkung fuer die Zukunft widerrufen.",
  },
  {
    code: "GLAUBENSANGABEN",
    version: 1,
    titel: "Angaben zu Glaube und Gemeindezugehörigkeit",
    // DSGVO Art. 9: besondere Kategorie. Muss getrennt und ausdruecklich
    // eingeholt werden — nie im Sammel-Haken mit dem allgemeinen Datenschutz.
    istArt9: true,
    pflicht: true,
    text:
      "Ich willige ausdruecklich ein, dass meine Angaben zu meinem Glauben und meiner " +
      "Gemeindezugehörigkeit verarbeitet werden. Diese Angaben sind für die Aufnahme in " +
      "eine Bibelschule erforderlich. Mir ist bekannt, dass es sich um Daten einer " +
      "besonderen Kategorie nach Art. 9 DSGVO handelt und dass ich diese Einwilligung " +
      "jederzeit widerrufen kann.",
  },
  // Fassung 2 (27.09.2026, Umstellung der Anwendung auf die Anrede „Sie“):
  // Die Texte sind Erklaerungen der Person und bleiben deshalb in der Ich-Form;
  // Titel, Inhalt, Art.-9-Kennzeichen und Pflicht sind unveraendert. Korrigiert
  // sind nur die Umschreibungen „fuer“ und „ausdruecklich“.
  {
    code: "DATENSCHUTZ",
    version: 2,
    titel: "Verarbeitung meiner Daten zur Durchführung der Ausbildung",
    istArt9: false,
    pflicht: true,
    text:
      "Ich willige ein, dass das Christliche Werk Esra e.V. meine im Anmeldeformular " +
      "angegebenen Daten zum Zweck der Durchführung und Verwaltung der Ausbildung an " +
      "der Gemeindebibelschule Minden verarbeitet. Die Einwilligung kann ich jederzeit " +
      "mit Wirkung für die Zukunft widerrufen.",
  },
  {
    code: "GLAUBENSANGABEN",
    version: 2,
    titel: "Angaben zu Glaube und Gemeindezugehörigkeit",
    istArt9: true,
    pflicht: true,
    text:
      "Ich willige ausdrücklich ein, dass meine Angaben zu meinem Glauben und meiner " +
      "Gemeindezugehörigkeit verarbeitet werden. Diese Angaben sind für die Aufnahme in " +
      "eine Bibelschule erforderlich. Mir ist bekannt, dass es sich um Daten einer " +
      "besonderen Kategorie nach Art. 9 DSGVO handelt und dass ich diese Einwilligung " +
      "jederzeit widerrufen kann.",
  },
];

// -----------------------------------------------------------------------------
// E-Mail-Vorlagen
// Inhaltlich bewusst schlicht: persoenliche Mails formuliert der Schulleiter
// selbst. Automatisiert ist nur die Mechanik, nicht der Ton.
//
// Betreffs tragen NIE einen Personennamen: Der gefuellte Betreff landet in
// `email_versand.betreff`, und diese Zeile haengt bei Verwaltungs-Mails an der
// personId des EMPFAENGERS. Die Anonymisierung (Art. 17 DSGVO) erreicht sie
// deshalb nicht. Der Name steht nur im Text, und der wird nicht protokolliert.
// -----------------------------------------------------------------------------
const MAIL_VORLAGEN = [
  {
    code: "MAGIC_LINK",
    bezeichnung: "Anmeldelink zum Portal",
    betreff: "Ihr Zugang zu GBS Campus",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "hier ist Ihr Zugang zu GBS Campus:\n\n{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}} und kann nur einmal verwendet werden.\n\n" +
      "Wenn Sie diesen Link nicht angefordert haben, können Sie diese Nachricht ignorieren.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung: "Einziger Weg ins Portal — fällt der Versand aus, kommt niemand hinein.",
  },
  {
    code: "ANMELDUNG_EINGEGANGEN",
    bezeichnung: "Eingangsbestätigung der Anmeldung",
    betreff: "Ihre Anmeldung ist eingegangen",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "Ihre Anmeldung zur Gemeindebibelschule Minden ist bei uns eingegangen. " +
      "Wir melden uns, sobald wir sie angesehen haben.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung: "Geht automatisch nach dem Absenden des Anmeldeformulars raus.",
  },
  {
    code: "ANMELDUNG_ANGENOMMEN",
    bezeichnung: "Aufnahmebestätigung",
    betreff: "Willkommen an der Gemeindebibelschule Minden",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "wir freuen uns, Sie an der Gemeindebibelschule Minden begrüßen zu dürfen.\n\n" +
      "Über Ihren persönlichen Zugang können Sie jederzeit Ihre Daten einsehen und ändern:\n\n" +
      "{{link}}\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung: "Wird vom Schulleiter beim Annehmen ausgelöst.",
  },
  {
    code: "ANMELDUNG_VERWALTUNG",
    bezeichnung: "Hinweis an die Verwaltung",
    betreff: "Neue Anmeldung eingegangen",
    textMd:
      "Es ist eine neue Anmeldung eingegangen:\n\n" +
      "{{name}}, {{email}}\nTeilnahmeform: {{teilnahmeform}}\n\n" +
      "In GBS Campus ansehen: {{link}}",
    beschreibung: "Direkter Wunsch aus dem Interview — die Verwaltung erfährt sofort von neuen Anmeldungen.",
  },
  {
    code: "ANMELDUNG_DOPPELT",
    bezeichnung: "Hinweis bei doppelter Anmeldung",
    betreff: "Zu Ihrer Adresse liegt uns bereits eine Anmeldung vor",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "Sie haben gerade eine Anmeldung zur Gemeindebibelschule Minden abgeschickt. Zu Ihrer " +
      "E-Mail-Adresse ist bei uns aber schon eine Anmeldung hinterlegt, deshalb haben wir keine " +
      "zweite angelegt.\n\n" +
      "Wenn das ein Versehen war, können Sie diese Nachricht ignorieren. Andernfalls melden Sie sich " +
      "einfach bei der Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die bereits bekannte Adresse. Nach außen bleibt die Antwort neutral — nur der Inhaber der Adresse erfährt davon.",
  },
  {
    code: "ANMELDUNG_DOPPELT_VERWALTUNG",
    bezeichnung: "Doppelte Anmeldung — Hinweis an die Verwaltung",
    betreff: "Doppelte Anmeldung abgefangen",
    textMd:
      "Zur Adresse {{email}} wurde erneut eine Anmeldung abgeschickt. Es wurde nichts angelegt und " +
      "nichts überschrieben.\n\n" +
      "Bitte prüfen, ob sich jemand ein zweites Mal anmelden möchte.\n\n" +
      "In GBS Campus ansehen: {{link}}",
    beschreibung: "Damit die Verwaltung merkt, wenn jemand nicht weiterkommt und es erneut versucht.",
  },
  {
    code: "EMAIL_AENDERUNG_ADRESSE_BELEGT",
    bezeichnung: "Angefragte Adresse ist bereits vergeben",
    betreff: "Diese E-Mail-Adresse wurde bei GBS Campus angefragt",
    textMd:
      "Guten Tag,\n\n" +
      "jemand wollte die Adresse {{adresse}} einem anderen Konto bei GBS Campus zuordnen. Weil sie " +
      "bereits vergeben ist, wurde nichts geändert — an Ihrem Konto ebenso wenig wie am anderen.\n\n" +
      "Wenn Sie das nicht waren, müssen Sie nichts tun. Bei Fragen wenden Sie sich an die Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an den Inhaber der belegten Adresse. Nennt bewusst KEINEN Namen — sonst erführe der Empfänger, wer sich bei der Bibelschule angemeldet hat (Art. 9 DSGVO).",
  },
  {
    code: "ZUGANG_HILFE_MELDUNG",
    bezeichnung: "Meldung „Ich komme nicht mehr ins Portal“",
    betreff: "Meldung zum Portalzugang",
    textMd:
      "{{name}} kommt nicht mehr ins Portal.\n\n" +
      "Erreichbar unter: {{erreichbar}}\n" +
      "Bisher hinterlegte Adresse laut eigener Angabe: {{bisherigeEmail}}\n\n" +
      "Mitteilung: {{mitteilung}}\n\n" +
      "ACHTUNG: Diese Angaben stammen aus einem öffentlichen Formular und sind ungeprüft.\n" +
      "Bitte erst die Person erkennen (Anruf, persönlich), dann unter Verwaltung → Personen die\n" +
      "E-Mail-Adresse ändern und den Anmeldelink schicken.",
    beschreibung:
      "Geht an Schulleitung UND Verwaltung — wer ausgesperrt ist, soll nicht warten müssen, bis eine bestimmte Person am Schreibtisch sitzt.",
  },
  {
    code: "DATENAENDERUNG_VERWALTUNG",
    bezeichnung: "Hinweis bei geänderten Stammdaten",
    betreff: "Stammdaten geändert",
    textMd:
      "{{name}} hat die eigenen Daten geändert.\n\n" +
      "Geändert wurde: {{felder}}\n\n" +
      "In GBS Campus ansehen: {{link}}",
    beschreibung: "Damit die Verwaltung Adress- und Bankänderungen nicht übersieht.",
  },
  {
    code: "EMAIL_AENDERUNG_BESTAETIGEN",
    bezeichnung: "Bestätigung einer neuen E-Mail-Adresse",
    betreff: "Bitte bestätigen Sie Ihre neue E-Mail-Adresse",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "Sie möchten Ihre E-Mail-Adresse für GBS Campus auf diese Adresse ändern. " +
      "Bitte bestätigen Sie das über diesen Link:\n\n{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}}. Bis zur Bestätigung bleibt Ihre bisherige Adresse gültig.\n\n" +
      "Wenn Sie das nicht waren, können Sie diese Nachricht ignorieren.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die NEUE Adresse. Ohne diesen Klick ändert sich nichts — die Adresse ist der einzige Zugang zum Portal.",
  },
  {
    code: "EMAIL_AENDERUNG_HINWEIS",
    bezeichnung: "Hinweis an die bisherige E-Mail-Adresse",
    betreff: "Änderung Ihrer E-Mail-Adresse wurde beantragt",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "für Ihr Konto bei GBS Campus wurde eine neue E-Mail-Adresse beantragt: {{neueAdresse}}\n\n" +
      "Sobald sie bestätigt ist, läuft Ihr Zugang über die neue Adresse.\n\n" +
      "Waren Sie das nicht, melden Sie sich bitte umgehend bei der Schulleitung. " +
      "Solange Sie nicht bestätigen, bleibt alles wie bisher.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die BISHERIGE Adresse und ist die Notbremse: Wer sie bekommt, ohne etwas geändert zu haben, kann Alarm schlagen.",
  },
  {
    code: "EMAIL_GEAENDERT_DURCH_VERWALTUNG",
    bezeichnung: "E-Mail-Adresse durch die Schule geändert",
    betreff: "Ihre E-Mail-Adresse für GBS Campus wurde geändert",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "Ihre E-Mail-Adresse für GBS Campus wurde von der Schule auf {{neueAdresse}} geändert. " +
      "Ab sofort läuft Ihr Zugang über diese Adresse.\n\n" +
      "Wenn Sie das nicht angefragt haben, melden Sie sich bitte umgehend bei der Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die alte UND die neue Adresse, wenn die Verwaltung eine Adresse ändert — etwa nach einer Meldung über das Hilfeformular.",
  },
  {
    code: "PASSWORT_GEAENDERT",
    bezeichnung: "Hinweis auf ein geändertes Passwort",
    betreff: "Ihr Passwort für GBS Campus wurde geändert",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "für Ihr Konto bei GBS Campus wurde {{vorgang}}.\n\n" +
      "Waren Sie das nicht, fordern Sie bitte sofort einen Anmeldelink an und setzen Sie ein neues Passwort — " +
      "und geben Sie der Schulleitung Bescheid.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Die Notbremse beim Passwort: Wer diesen Hinweis bekommt, ohne etwas geändert zu haben, weiß, dass jemand an seinem Konto war.",
  },
  {
    // Geht an die hinterlegte Adresse, wenn IBAN oder Kontoinhaber ueber die
    // Selbstpflege geaendert werden. Die Aenderung wirkt sofort (Honorar,
    // kuenftiger Beitragseinzug) — wer eine Sitzung uebernommen hat, koennte
    // sonst unbemerkt Zahlungen umleiten. Gegen eine Postfach-Uebernahme hilft
    // der Hinweis nicht (er landet beim Angreifer); dafuer steht Entscheidung E1
    // (Freigabe-Bestaetigung) aus. Nie die IBAN selbst im Text. Jedes (erste
    // oder neue) Passwort setzt passwortGeaendertAm und beendet fremde Sitzungen
    // — deshalb der Rat an alle, nicht nur an Personen mit Passwort.
    code: "BANKVERBINDUNG_GEAENDERT",
    bezeichnung: "Hinweis auf eine geänderte Bankverbindung",
    betreff: "Ihre Bankverbindung bei GBS Campus wurde geändert",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "in Ihrem Konto bei GBS Campus wurde soeben geändert: {{felder}}. " +
      "Die neue Bankverbindung steht aus Sicherheitsgründen nicht in dieser Nachricht.\n\n" +
      "Waren Sie das nicht, melden Sie sich umgehend bei der Schulleitung und setzen Sie unter „Meine Daten“ ein (neues) " +
      "Passwort, damit fremde Sitzungen enden.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Die Notbremse bei der Bankverbindung: Geht an die hinterlegte Adresse, wenn jemand über „Meine Daten“ IBAN oder Kontoinhaber ändert.",
  },
  {
    code: "AUSKUNFT_BEREIT",
    bezeichnung: "Datenauskunft nach Art. 15 DSGVO steht bereit",
    betreff: "Ihre Datenauskunft der Gemeindebibelschule steht bereit",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "auf Anforderung wurde eine Auskunft über die zu Ihnen gespeicherten Daten nach Art. 15 DSGVO " +
      "erstellt. Über den folgenden persönlichen Link können Sie die Auskunft als PDF herunterladen:\n\n" +
      "{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}} und führt zu Ihren persönlichen Daten. Bitte geben Sie ihn nicht weiter.\n\n" +
      "Haben Sie keine Auskunft angefordert, können Sie diese Nachricht ignorieren — ohne den Link wird nichts angezeigt.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Trägt nur den Abruf-Link, nie die Daten selbst — Glaubensangaben und IBAN dürfen den Mailkanal nicht verlassen.",
  },
  {
    code: "UEBERLEITUNG_EINLADUNG",
    bezeichnung: "Einladung ins Folgesemester (Re-Enrollment)",
    betreff: "Sind Sie im {{semester}} dabei?",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "das nächste Semester an der Gemeindebibelschule Minden steht an: {{semester}} " +
      "({{zeitraum}}).\n\n" +
      "Sind Sie wieder dabei? Über diesen Link sagen Sie mit einem Klick „Ich bin dabei“ oder „Ich bin raus“:\n\n{{link}}\n\n" +
      "Antworten – und Ihre Antwort über denselben Link ändern – können Sie bis einschließlich {{frist}}. " +
      "Ohne Rückmeldung bis dahin gilt Ihre Teilnahme am neuen Semester als abgemeldet.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Startet die Semesterüberleitung: geht an alle Teilnehmer des laufenden Semesters mit dem persönlichen Link für „Ich bin dabei“ oder „Ich bin raus“.",
  },
  {
    code: "UEBERLEITUNG_ERINNERUNG",
    bezeichnung: "Erinnerung an die Rückmeldung fürs Folgesemester",
    betreff: "Erinnerung: Sind Sie im {{semester}} dabei?",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "kurze Erinnerung: Für {{semester}} ({{zeitraum}}) fehlt uns noch Ihre " +
      "Rückmeldung. Sind Sie dabei oder sind Sie raus? Ein Klick auf den Link genügt:\n\n{{link}}\n\n" +
      "Bitte verwenden Sie den Link aus dieser neuesten E-Mail — ältere Links gelten nicht mehr. Antworten können Sie " +
      "bis einschließlich {{frist}}; ohne Rückmeldung bis dahin gilt Ihre Teilnahme am neuen Semester als " +
      "abgemeldet.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Automatische Erinnerung (T-14/-7/-3 vor Semesterstart) an alle Eingeladenen ohne Antwort. Jede zugestellte Erinnerung trägt einen frischen Link; ältere verfallen damit. Eine gescheiterte Erinnerung wird nicht wiederholt – die nächste Stufe versucht es erneut. Fällt die Einladung auf einen Stichtag oder später, zählt sie für diese Stichtage mit (nie zwei Mails am selben Tag).",
  },
  {
    code: "ANMELDUNG_GEDROSSELT",
    bezeichnung: "Warnung: Gesamtgrenze des Anmeldeformulars erreicht",
    betreff: "Anmeldeformular: ungewöhnlich viele Anmeldungen",
    textMd:
      "Guten Tag,\n\n" +
      "im öffentlichen Anmeldeformular ist die Obergrenze erreicht: {{grenze}}. Weitere Anmeldungen " +
      "werden vorerst abgewiesen; die Absender sehen den Hinweis, es später erneut zu versuchen.\n\n" +
      "Bitte prüfen Sie die zuletzt eingegangenen Anmeldungen: {{link}}\n\n" +
      "Handelt es sich um echte Bewerbungen, können Sie die Grenze unter Verwaltung → Einstellungen " +
      "anheben. Diese Nachricht geht höchstens einmal pro Stunde hinaus.\n\n" +
      "GBS Campus",
    beschreibung:
      "Geht an Schulleitung und Verwaltung, wenn die Gesamtgrenze je Stunde oder je Tag greift (Schutz vor Massenanmeldungen, lib/anmelde-schutz.ts) — höchstens einmal pro Stunde. Ohne Personennamen: Die Absender sind unbekannt.",
  },
];

// -----------------------------------------------------------------------------
// Ermaessigungen
//
// Bewusst als Datensatz statt als Konstante im Code: Der Satz laesst sich ohne
// Deploy aendern, und weitere Faelle kommen ueber die Jahre dazu. Der
// Beitragslauf, der diese Saetze anwendet, entsteht in einem kuenftigen Release.
// -----------------------------------------------------------------------------
const ERMAESSIGUNGEN = [
  {
    code: "EHEPARTNER",
    bezeichnung: "Ehepartner",
    beschreibung:
      "Melden sich beide Ehepartner an, zahlt der zweite die Hälfte. Die Kopplung wird in der Akte gesetzt und ist aufloesbar.",
    prozent: 50,
    aktiv: true,
    sortierung: 10,
  },
];

// -----------------------------------------------------------------------------
// Semester — die sechs realen Semester des Jahrgangs 2026–2029
//
// Termine aus der Kursübersicht von gbs-minden.de. Genau EIN Semester ist das
// laufende (2026-H, Kursstart 15.09.2026) — abgesichert durch den partiellen
// Unique-Index `semester_genau_ein_aktuelles`. Der Seed legt die Liste nur bei
// leerer Semestertabelle an und aktualisiert sie nie (siehe main()) — auch
// `istAktuell` wird damit nur beim Erstanlegen gesetzt.
// lehrjahr/halbjahr verorten das Semester im Kursraster (halbjahr 1 = Herbst,
// 2 = Frühling). Datumsangaben als UTC-Mitternacht (Felder sind @db.Date).
// -----------------------------------------------------------------------------
const SEMESTER = [
  { code: "2026-H", bezeichnung: "Herbstsemester 2026", start: new Date("2026-09-15"), ende: new Date("2026-12-01"), lehrjahr: 1, halbjahr: 1, istAktuell: true },
  { code: "2027-F", bezeichnung: "Frühlingssemester 2027", start: new Date("2027-02-16"), ende: new Date("2027-05-04"), lehrjahr: 1, halbjahr: 2, istAktuell: false },
  { code: "2027-H", bezeichnung: "Herbstsemester 2027", start: new Date("2027-09-21"), ende: new Date("2027-12-07"), lehrjahr: 2, halbjahr: 1, istAktuell: false },
  { code: "2028-F", bezeichnung: "Frühlingssemester 2028", start: new Date("2028-02-15"), ende: new Date("2028-05-02"), lehrjahr: 2, halbjahr: 2, istAktuell: false },
  { code: "2028-H", bezeichnung: "Herbstsemester 2028", start: new Date("2028-09-12"), ende: new Date("2028-12-05"), lehrjahr: 3, halbjahr: 1, istAktuell: false },
  { code: "2029-F", bezeichnung: "Frühlingssemester 2029", start: new Date("2029-02-13"), ende: new Date("2029-05-08"), lehrjahr: 3, halbjahr: 2, istAktuell: false },
];

// Fächer & Kurseinheiten liegen als EINE Quelle in `./kursraster-definition.ts`
// (auch vom Prüfskript genutzt) — siehe Import oben.

// -----------------------------------------------------------------------------
// Anmeldeformular — Startfassung (Bewerbungsformular)
//
// Die Felddefinition liegt in `./anmeldeformular-definition.ts` — EINE Quelle,
// die auch das manuelle Nachtrag-Skript `scripts/anmeldeformular-bewerbung.ts`
// nutzt. Der Seed legt daraus Version 1 an; der Schulleiter aendert das Formular
// ab hier selbst im Cockpit, jede Aenderung erzeugt eine neue Version. Die
// Glaubens- und Gemeindefelder sind dort durchgaengig als Art. 9 markiert.
// -----------------------------------------------------------------------------
const ANMELDEFORMULAR = {
  code: "ANMELDUNG",
  bezeichnung: "Anmeldung zur Gemeindebibelschule",
  beschreibung: "Bewerbungsformular für neue Teilnehmer.",
  einleitung: EINLEITUNG,
  abschnitte: ABSCHNITTE,
};

async function seedFormular() {
  const formular = await prisma.formular.upsert({
    where: { code: ANMELDEFORMULAR.code },
    update: { bezeichnung: ANMELDEFORMULAR.bezeichnung, beschreibung: ANMELDEFORMULAR.beschreibung },
    create: {
      code: ANMELDEFORMULAR.code,
      bezeichnung: ANMELDEFORMULAR.bezeichnung,
      beschreibung: ANMELDEFORMULAR.beschreibung,
    },
  });

  // Nur anlegen, wenn es noch gar keine Fassung gibt. Ein spaeterer Seed-Lauf
  // darf niemals ueberschreiben, was der Schulleiter inzwischen gestaltet hat.
  const vorhanden = await prisma.formularVersion.count({ where: { formularId: formular.id } });
  if (vorhanden > 0) {
    console.log("[Seed] Anmeldeformular existiert bereits — unveraendert gelassen.");
    return;
  }

  await prisma.formularVersion.create({
    data: {
      formularId: formular.id,
      version: 1,
      status: "VEROEFFENTLICHT",
      einleitung: ANMELDEFORMULAR.einleitung,
      veroeffentlichtAm: new Date(),
      abschnitte: {
        create: ANMELDEFORMULAR.abschnitte.map((abschnitt, abschnittIndex) => ({
          titel: abschnitt.titel,
          beschreibung: abschnitt.beschreibung,
          reihenfolge: abschnittIndex,
          felder: {
            create: abschnitt.felder.map((feld, feldIndex) => ({
              code: feld.code,
              typ: feld.typ as never,
              label: feld.label,
              hilfetext: "hilfetext" in feld ? (feld.hilfetext as string) : null,
              pflicht: feld.pflicht,
              reihenfolge: feldIndex,
              optionen: "optionen" in feld ? (feld.optionen as string[]) : undefined,
              personFeld: ("personFeld" in feld ? feld.personFeld : "NICHTS") as never,
              istArt9: "istArt9" in feld ? Boolean(feld.istArt9) : false,
              validierung:
                "teilnahmeformZuordnung" in feld
                  ? { teilnahmeform: feld.teilnahmeformZuordnung }
                  : undefined,
            })),
          },
        })),
      },
    },
  });

  const felder = ANMELDEFORMULAR.abschnitte.reduce((summe, a) => summe + a.felder.length, 0);
  console.log(`[Seed] Anmeldeformular Version 1 angelegt: ${ANMELDEFORMULAR.abschnitte.length} Abschnitte, ${felder} Felder.`);
}

async function main() {
  console.log("[Seed] Statusmaschine...");
  for (const status of STATUS) {
    await prisma.teilnehmerStatus.upsert({
      where: { code: status.code },
      update: status,
      create: status,
    });
  }

  console.log("[Seed] Rechte...");
  for (const recht of RECHTE) {
    await prisma.recht.upsert({ where: { code: recht.code }, update: recht, create: recht });
  }

  console.log("[Seed] Rollen und Rechtematrix...");
  for (const { rechte, ...rolle } of ROLLEN) {
    // Die Matrix wird je Rolle neu gesetzt, damit entzogene Rechte auch
    // wirklich verschwinden und nicht als Altlast haengen bleiben. Je Rolle in
    // EINER Transaktion: Bricht der Seed zwischen Loeschen und Neuanlegen ab
    // (Neustart, DB-Aussetzer), stuende die Rolle sonst ohne Rechte da — bei
    // ADMIN/SCHULLEITER sperrte das die Verwaltung bis zum naechsten Start aus.
    await prisma.$transaction(async (tx) => {
      await tx.rolle.upsert({ where: { code: rolle.code }, update: rolle, create: rolle });
      await tx.rolleRecht.deleteMany({ where: { rolleCode: rolle.code } });
      if (rechte.length > 0) {
        await tx.rolleRecht.createMany({
          data: rechte.map((rechtCode) => ({ rolleCode: rolle.code, rechtCode })),
        });
      }
    });
  }

  console.log("[Seed] Einwilligungstexte...");
  // Nur anlegen, NIE ueberschreiben: Erteilte Einwilligungen verweisen auf ihre
  // Fassung (code, version). Setzte der Seed Titel oder Text einer bestehenden
  // Fassung neu, zeigten alle bisherigen Einwilligungen still auf einen Text,
  // dem niemand zugestimmt hat (Nachweis nach Art. 7 Abs. 1 DSGVO). Ein
  // geaenderter Text ist deshalb immer eine neue Fassung (version + 1). Die
  // Datenbank sperrt das zusaetzlich per Trigger (Migration
  // 20260927100000_einwilligungstexte_unveraenderlich) — bewusst kein upsert,
  // damit der Seed nicht einmal ein leeres UPDATE absetzt.
  for (const einwilligung of EINWILLIGUNGEN) {
    const vorhanden = await prisma.einwilligungsText.findUnique({
      where: { code_version: { code: einwilligung.code, version: einwilligung.version } },
    });
    if (!vorhanden) {
      await prisma.einwilligungsText.create({ data: einwilligung });
      continue;
    }
    const abweichend =
      vorhanden.titel !== einwilligung.titel ||
      vorhanden.text !== einwilligung.text ||
      vorhanden.istArt9 !== einwilligung.istArt9 ||
      vorhanden.pflicht !== einwilligung.pflicht;
    if (abweichend) {
      console.warn(
        `[Seed] WARNUNG: Einwilligungstext ${einwilligung.code} Fassung ${einwilligung.version} weicht vom Seed ab ` +
          "und bleibt unveraendert. Ein geaenderter Text braucht eine neue Fassung (version + 1).",
      );
    }
  }

  // Die neueste Fassung eines Codes loest die aelteren ab: Deren `aktivBis`
  // wird auf den Gueltigkeitsbeginn der neuesten gesetzt — das Einzige, was der
  // Trigger an einer Fassung aendern laesst. Nur bei Fassungen ohne Ende; ist
  // `aktivBis` schon gesetzt, bleibt es, wie es ist (ein weiterer Seed-Lauf
  // aendert nichts). Fuer die Auswahl waere das nicht noetig —
  // `ladeEinwilligungstexte` nimmt ohnehin die hoechste gueltige Fassung —, aber
  // so gilt in der Datenbank je Code genau eine Fassung, und die Laufzeit der
  // alten steht fest. Die erteilten Einwilligungen bleiben an ihrer Fassung und
  // damit wirksam (die Wirksamkeit wertet je Code ueber alle Fassungen aus,
  // `art9EinwilligungenWirksam`).
  const neuesteFassung = new Map<string, number>();
  for (const { code, version } of EINWILLIGUNGEN) {
    neuesteFassung.set(code, Math.max(version, neuesteFassung.get(code) ?? 0));
  }
  for (const [code, version] of neuesteFassung) {
    const neueste = await prisma.einwilligungsText.findUnique({
      where: { code_version: { code, version } },
      select: { aktivAb: true },
    });
    if (!neueste) continue;
    const abgeloest = await prisma.einwilligungsText.updateMany({
      where: { code, version: { lt: version }, aktivBis: null },
      data: { aktivBis: neueste.aktivAb },
    });
    if (abgeloest.count > 0) {
      console.log(
        `[Seed] Einwilligungstext ${code}: ${abgeloest.count} aeltere Fassung(en) durch Fassung ${version} ` +
          `abgeloest (aktivBis = ${neueste.aktivAb.toISOString()}).`,
      );
    }
  }

  console.log("[Seed] E-Mail-Vorlagen...");
  for (const vorlage of MAIL_VORLAGEN) {
    await prisma.emailVorlage.upsert({
      where: { code: vorlage.code },
      update: vorlage,
      create: vorlage,
    });
  }

  console.log("[Seed] Einstellungen...");
  for (const [schluessel, d] of Object.entries(EINSTELLUNGEN)) {
    // Der Wert wird bewusst NICHT aktualisiert: Was der Betrieb eingestellt hat,
    // darf ein Seed-Lauf nach dem naechsten Deploy nicht zurueckdrehen.
    // Beschriftung, Grenzen und Einheit werden dagegen mitgezogen.
    await prisma.einstellung.upsert({
      where: { schluessel },
      update: {
        bezeichnung: d.bezeichnung,
        beschreibung: d.beschreibung,
        bereich: d.bereich,
        typ: d.typ,
        minimum: d.minimum,
        maximum: d.maximum,
        einheit: d.einheit,
        sortierung: d.sortierung,
      },
      create: {
        schluessel,
        bezeichnung: d.bezeichnung,
        beschreibung: d.beschreibung,
        bereich: d.bereich,
        typ: d.typ,
        wert: String(d.standard),
        minimum: d.minimum,
        maximum: d.maximum,
        einheit: d.einheit,
        sortierung: d.sortierung,
      },
    });
  }

  // Honorarsatz-Historie: erste Zeile aus dem bisherigen Einzel-Regler ableiten
  // (Release 0.2 → 0.3). Idempotent — nur anlegen, wenn die Historie leer ist —,
  // damit ein Seed-Lauf spaeter genehmigte Saetze nicht ueberschreibt. Danach die
  // abgeloeste Einstellung entfernen: sie steuert nichts mehr und wuerde sonst
  // als toter Regler in der Einstellungen-Oberflaeche stehenbleiben.
  console.log("[Seed] Honorarsatz-Historie...");
  const bisherigerSatz = await prisma.einstellung.findUnique({ where: { schluessel: "HONORAR_SATZ_PRO_ABEND" } });
  const startBetrag = bisherigerSatz ? Number(bisherigerSatz.wert) : HONORAR_SATZ_FALLBACK;
  const vorhandene = await prisma.honorarSatz.count();
  if (vorhandene === 0) {
    await prisma.honorarSatz.create({
      data: {
        betrag: Number.isInteger(startBetrag) ? startBetrag : HONORAR_SATZ_FALLBACK,
        // Frueher als jedes Semester (2026+), damit jeder Abend einen Satz findet.
        gueltigAb: new Date("2000-01-01T00:00:00.000Z"),
        notiz: "Aus dem bisherigen Honorarsatz übernommen (Umstellung auf die Satz-Historie).",
        genehmigtVonId: null,
      },
    });
  }
  await prisma.einstellung.deleteMany({ where: { schluessel: "HONORAR_SATZ_PRO_ABEND" } });

  console.log("[Seed] Ermaessigungen...");
  for (const ermaessigung of ERMAESSIGUNGEN) {
    await prisma.ermaessigung.upsert({
      where: { code: ermaessigung.code },
      update: ermaessigung,
      create: ermaessigung,
    });
  }

  console.log("[Seed] Semester...");
  // Nur bei LEERER Semestertabelle anlegen, danach nie wieder anfassen. Ab dem
  // ersten Start gehoeren die Semester dem Betrieb: Bezeichnung, Daten und
  // Kuerzel pflegt die Verwaltung in der Oberflaeche, und ein Deploy darf das
  // nicht zuruecksetzen (an `start` haengen Erinnerungen, Link-Ablauf und
  // Dienstagstermine). Ein upsert ueber `code` tat genau das — und legte ein
  // umbenanntes Semester unter dem alten Kuerzel neu an, bei 2026-H mit
  // istAktuell = true. Das verletzte `semester_genau_ein_aktuelles`, der Seed
  // endete mit Exit 1 und der Container startete in einer Endlosschleife neu.
  // `istAktuell` setzt der Seed deshalb nur hier beim Erstanlegen (2026-H); in
  // einem Zug per createMany, damit ein Abbruch keine halbe Liste hinterlaesst.
  const semesterVorhanden = await prisma.semester.count();
  if (semesterVorhanden === 0) {
    await prisma.semester.createMany({ data: SEMESTER });
  } else {
    console.log("[Seed] Semester existieren bereits — unveraendert gelassen.");
  }

  console.log("[Seed] Faecher...");
  for (const fach of FAECHER) {
    await prisma.fach.upsert({ where: { code: fach.code }, update: fach, create: fach });
  }

  console.log("[Seed] Kurseinheiten...");
  for (const k of KURSEINHEITEN) {
    await prisma.kurseinheit.upsert({
      where: {
        fachCode_jahrgangsjahr_halbjahr: {
          fachCode: k.fachCode,
          jahrgangsjahr: k.jahrgangsjahr,
          halbjahr: k.halbjahr,
        },
      },
      update: k,
      create: k,
    });
  }

  console.log("[Seed] Anmeldeformular...");
  await seedFormular();

  const zahlen = {
    status: await prisma.teilnehmerStatus.count(),
    rollen: await prisma.rolle.count(),
    rechte: await prisma.recht.count(),
    zuordnungen: await prisma.rolleRecht.count(),
    einwilligungen: await prisma.einwilligungsText.count(),
    vorlagen: await prisma.emailVorlage.count(),
    formularFelder: await prisma.formularFeld.count(),
    ermaessigungen: await prisma.ermaessigung.count(),
    einstellungen: await prisma.einstellung.count(),
    semester: await prisma.semester.count(),
    faecher: await prisma.fach.count(),
    kurseinheiten: await prisma.kurseinheit.count(),
    honorarSaetze: await prisma.honorarSatz.count(),
  };
  console.log("[Seed] Fertig:", zahlen);
}

main()
  .catch((fehler) => {
    console.error("[Seed] Fehlgeschlagen:", fehler);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

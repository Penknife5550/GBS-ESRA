/**
 * GBS Campus — Grunddaten
 *
 * Idempotent: laeuft bei jedem Start des App-Containers und legt nur an, was
 * fehlt. Bestehende Datensaetze werden aktualisiert, nicht dupliziert.
 *
 * Was hier steht, ist bewusst KEINE Konfiguration im Code: Status, Rollen und
 * Rechte liegen als Daten in der Datenbank und lassen sich ohne Deploy
 * erweitern. Der Seed setzt nur den Ausgangsstand.
 */

import { PrismaClient } from "@prisma/client";
import { EINSTELLUNGEN } from "../src/lib/einstellungen";
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
    beschreibung: "Ausbildung abgeschlossen.",
    istAktiv: false,
    istTerminal: true,
    beitragLaeuft: false,
    anwesenheitZaehlt: false,
    automatikMails: true,
    sortierung: 50,
  },
  {
    code: "ABGEBROCHEN",
    bezeichnung: "Abgebrochen",
    beschreibung: "Freiwillig ausgestiegen. Der Beitragslauf stoppt.",
    istAktiv: false,
    istTerminal: true,
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
// -----------------------------------------------------------------------------
const RECHTE = [
  { code: "PERSON_LESEN_EIGENE", bezeichnung: "Eigene Daten sehen", bereich: "PERSON" },
  { code: "PERSON_BEARBEITEN_EIGENE", bezeichnung: "Eigene Daten aendern", bereich: "PERSON" },
  { code: "PERSON_LESEN_ALLE", bezeichnung: "Alle Personen sehen", bereich: "PERSON" },
  { code: "PERSON_BEARBEITEN_ALLE", bezeichnung: "Stammdaten aller Personen aendern", bereich: "PERSON" },
  { code: "PERSON_STATUS_WECHSELN", bezeichnung: "Teilnehmerstatus aendern", bereich: "PERSON" },
  { code: "PERSON_EXPORTIEREN", bezeichnung: "Teilnehmerliste exportieren", bereich: "PERSON" },
  { code: "PERSON_ANONYMISIEREN", bezeichnung: "Person anonymisieren (Löschung nach Art. 17 DSGVO)", bereich: "PERSON" },
  { code: "SEMESTER_VERWALTEN", bezeichnung: "Semester anlegen und das laufende festlegen", bereich: "PERSON" },
  { code: "ANMELDUNG_LESEN", bezeichnung: "Anmeldungen einsehen", bereich: "ANMELDUNG" },
  { code: "ANMELDUNG_ENTSCHEIDEN", bezeichnung: "Anmeldungen annehmen oder ablehnen", bereich: "ANMELDUNG" },
  { code: "FORMULAR_BEARBEITEN", bezeichnung: "Anmeldeformulare gestalten", bereich: "ANMELDUNG" },
  { code: "FORMULAR_VEROEFFENTLICHEN", bezeichnung: "Formularfassung veroeffentlichen", bereich: "ANMELDUNG" },
  { code: "MAIL_VERTEILER_SENDEN", bezeichnung: "Rundmail an einen Verteiler senden", bereich: "KOMMUNIKATION" },
  { code: "MAIL_VORLAGEN_BEARBEITEN", bezeichnung: "E-Mail-Vorlagen bearbeiten", bereich: "KOMMUNIKATION" },
  { code: "FINANZ_DATEN_LESEN", bezeichnung: "Beitragsstatus sehen", bereich: "FINANZEN" },
  // Bewusst getrennt vom Beitragsstatus: die IBAN sieht nur, wer sie zum
  // Arbeiten braucht (Datenminimierung, DSGVO Art. 5 Abs. 1 lit. c).
  { code: "BANKVERBINDUNG_LESEN", bezeichnung: "Bankverbindung sehen", bereich: "FINANZEN" },
  { code: "BENUTZER_VERWALTEN", bezeichnung: "Konten und Rollen verwalten", bereich: "SYSTEM" },
  { code: "SYSTEM_EINSTELLUNGEN", bezeichnung: "Systemeinstellungen aendern", bereich: "SYSTEM" },
  { code: "AUDIT_LESEN", bezeichnung: "Audit-Log lesen", bereich: "SYSTEM" },
  { code: "IMPERSONATION", bezeichnung: "Sicht einer anderen Person einnehmen", bereich: "SYSTEM" },
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
      "BENUTZER_VERWALTEN",
      "SYSTEM_EINSTELLUNGEN",
      "AUDIT_LESEN",
      "IMPERSONATION",
      "PERSON_LESEN_ALLE",
      "MAIL_VORLAGEN_BEARBEITEN",
      "PERSON_LESEN_EIGENE",
      "PERSON_BEARBEITEN_EIGENE",
    ],
  },
  {
    code: "SCHULLEITER",
    bezeichnung: "Schulleiter",
    beschreibung: "Fachliche Vollverantwortung.",
    aktivAbRelease: "0.1",
    sortierung: 20,
    rechte: [
      "PERSON_LESEN_ALLE",
      "PERSON_BEARBEITEN_ALLE",
      "PERSON_STATUS_WECHSELN",
      "PERSON_EXPORTIEREN",
      // Die Anonymisierung (Art. 17 DSGVO) ist eine schwerwiegende, endgueltige
      // Entscheidung — sie liegt bei der Schulleitung, nicht bei der Verwaltung.
      "PERSON_ANONYMISIEREN",
      "SEMESTER_VERWALTEN",
      "ANMELDUNG_LESEN",
      "ANMELDUNG_ENTSCHEIDEN",
      "FORMULAR_BEARBEITEN",
      "FORMULAR_VEROEFFENTLICHEN",
      "MAIL_VERTEILER_SENDEN",
      "MAIL_VORLAGEN_BEARBEITEN",
      "FINANZ_DATEN_LESEN",
      // Ohne dieses Recht sähe die Schulleitung die Protokollansicht nicht — und
      // genau die Vorgänge dort sind ihre: Meldungen aus dem Hilfeformular,
      // Adressänderungen an fremden Konten, fehlgeschlagene Anmeldeversuche.
      // Bei Bus-Faktor 1 darf das nicht an einem einzigen Konto hängen.
      "AUDIT_LESEN",
      "PERSON_LESEN_EIGENE",
      "PERSON_BEARBEITEN_EIGENE",
    ],
  },
  {
    code: "VERWALTUNG",
    bezeichnung: "Verwaltung",
    beschreibung: "Finanzen und Stammdaten. Keine paedagogischen Entscheidungen.",
    aktivAbRelease: "0.1",
    sortierung: 30,
    rechte: [
      "PERSON_LESEN_ALLE",
      "PERSON_BEARBEITEN_ALLE",
      "PERSON_EXPORTIEREN",
      "SEMESTER_VERWALTEN",
      "ANMELDUNG_LESEN",
      "FINANZ_DATEN_LESEN",
      "BANKVERBINDUNG_LESEN",
      "MAIL_VERTEILER_SENDEN",
      "PERSON_LESEN_EIGENE",
      "PERSON_BEARBEITEN_EIGENE",
    ],
  },
  {
    code: "TEILNEHMER",
    bezeichnung: "Teilnehmer",
    beschreibung: "Schueler oder Hoerer. Sieht ausschliesslich die eigenen Daten.",
    aktivAbRelease: "0.1",
    sortierung: 40,
    rechte: ["PERSON_LESEN_EIGENE", "PERSON_BEARBEITEN_EIGENE"],
  },
  {
    code: "DOZENT",
    bezeichnung: "Dozent",
    beschreibung: "Verantwortet einen ganzen Kurs. Rechte sind auf das eigene Fach begrenzt.",
    aktivAbRelease: "0.2",
    sortierung: 50,
    rechte: ["PERSON_LESEN_EIGENE", "PERSON_BEARBEITEN_EIGENE"],
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
// -----------------------------------------------------------------------------
const EINWILLIGUNGEN = [
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
];

// -----------------------------------------------------------------------------
// E-Mail-Vorlagen
// Inhaltlich bewusst schlicht: persoenliche Mails formuliert der Schulleiter
// selbst. Automatisiert ist nur die Mechanik, nicht der Ton.
// -----------------------------------------------------------------------------
const MAIL_VORLAGEN = [
  {
    code: "MAGIC_LINK",
    bezeichnung: "Anmeldelink zum Portal",
    betreff: "Dein Zugang zu GBS Campus",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "hier ist dein Zugang zu GBS Campus:\n\n{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}} und kann nur einmal verwendet werden.\n\n" +
      "Wenn du diesen Link nicht angefordert hast, kannst du diese Nachricht ignorieren.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung: "Einziger Weg ins Portal — fällt der Versand aus, kommt niemand hinein.",
  },
  {
    code: "ANMELDUNG_EINGEGANGEN",
    bezeichnung: "Eingangsbestätigung der Anmeldung",
    betreff: "Deine Anmeldung ist angekommen",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "deine Anmeldung zur Gemeindebibelschule Minden ist bei uns eingegangen. " +
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
      "wir freuen uns, dich an der Gemeindebibelschule Minden begrüßen zu dürfen.\n\n" +
      "Über deinen persönlichen Zugang kannst du jederzeit deine Daten einsehen und ändern:\n\n" +
      "{{link}}\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung: "Wird vom Schulleiter beim Annehmen ausgelöst.",
  },
  {
    code: "ANMELDUNG_VERWALTUNG",
    bezeichnung: "Hinweis an die Verwaltung",
    betreff: "Neue Anmeldung: {{name}}",
    textMd:
      "Es ist eine neue Anmeldung eingegangen:\n\n" +
      "{{name}}, {{email}}\nTeilnahmeform: {{teilnahmeform}}\n\n" +
      "In GBS Campus ansehen: {{link}}",
    beschreibung: "Direkter Wunsch aus dem Interview — die Verwaltung erfährt sofort von neuen Anmeldungen.",
  },
  {
    code: "ANMELDUNG_DOPPELT",
    bezeichnung: "Hinweis bei doppelter Anmeldung",
    betreff: "Zu deiner Adresse liegt uns bereits eine Anmeldung vor",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "du hast gerade eine Anmeldung zur Gemeindebibelschule Minden abgeschickt. Zu deiner " +
      "E-Mail-Adresse ist bei uns aber schon eine Anmeldung hinterlegt, deshalb haben wir keine " +
      "zweite angelegt.\n\n" +
      "Wenn das ein Versehen war, kannst du diese Nachricht ignorieren. Andernfalls melde dich " +
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
      "bereits vergeben ist, wurde nichts geändert — an deinem Konto ebenso wenig wie am anderen.\n\n" +
      "Wenn du das nicht warst, musst du nichts tun. Bei Fragen wende dich an die Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an den Inhaber der belegten Adresse. Nennt bewusst KEINEN Namen — sonst erführe der Empfänger, wer sich bei der Bibelschule angemeldet hat (Art. 9 DSGVO).",
  },
  {
    code: "ZUGANG_HILFE_MELDUNG",
    bezeichnung: "Meldung „Ich komme nicht mehr ins Portal“",
    betreff: "Kommt nicht ins Portal: {{name}}",
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
    betreff: "Stammdaten geändert: {{name}}",
    textMd:
      "{{name}} hat die eigenen Daten geändert.\n\n" +
      "Geändert wurde: {{felder}}\n\n" +
      "In GBS Campus ansehen: {{link}}",
    beschreibung: "Damit die Verwaltung Adress- und Bankänderungen nicht übersieht.",
  },
  {
    code: "EMAIL_AENDERUNG_BESTAETIGEN",
    bezeichnung: "Bestätigung einer neuen E-Mail-Adresse",
    betreff: "Bitte bestätige deine neue E-Mail-Adresse",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "du möchtest deine E-Mail-Adresse für GBS Campus auf diese Adresse ändern. " +
      "Bitte bestätige das über diesen Link:\n\n{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}}. Bis zur Bestätigung bleibt deine bisherige Adresse gültig.\n\n" +
      "Wenn du das nicht warst, kannst du diese Nachricht ignorieren.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die NEUE Adresse. Ohne diesen Klick ändert sich nichts — die Adresse ist der einzige Zugang zum Portal.",
  },
  {
    code: "EMAIL_AENDERUNG_HINWEIS",
    bezeichnung: "Hinweis an die bisherige E-Mail-Adresse",
    betreff: "Änderung deiner E-Mail-Adresse wurde beantragt",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "für dein Konto bei GBS Campus wurde eine neue E-Mail-Adresse beantragt: {{neueAdresse}}\n\n" +
      "Sobald sie bestätigt ist, läuft dein Zugang über die neue Adresse.\n\n" +
      "Warst du das nicht, melde dich bitte umgehend bei der Schulleitung. " +
      "Solange du nicht bestätigst, bleibt alles wie bisher.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die BISHERIGE Adresse und ist die Notbremse: Wer sie bekommt, ohne etwas geändert zu haben, kann Alarm schlagen.",
  },
  {
    code: "EMAIL_GEAENDERT_DURCH_VERWALTUNG",
    bezeichnung: "E-Mail-Adresse durch die Schule geändert",
    betreff: "Deine E-Mail-Adresse für GBS Campus wurde geändert",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "deine E-Mail-Adresse für GBS Campus wurde von der Schule auf {{neueAdresse}} geändert. " +
      "Ab sofort läuft dein Zugang über diese Adresse.\n\n" +
      "Wenn du das nicht angefragt hast, melde dich bitte umgehend bei der Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Geht an die alte UND die neue Adresse, wenn die Verwaltung eine Adresse ändert — etwa nach einer Meldung über das Hilfeformular.",
  },
  {
    code: "PASSWORT_GEAENDERT",
    bezeichnung: "Hinweis auf ein geändertes Passwort",
    betreff: "Dein Passwort für GBS Campus wurde geändert",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "für dein Konto bei GBS Campus wurde {{vorgang}}.\n\n" +
      "Warst du das nicht, fordere bitte sofort einen Anmeldelink an und setze ein neues Passwort — " +
      "und gib der Schulleitung Bescheid.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Die Notbremse beim Passwort: Wer diesen Hinweis bekommt, ohne etwas geändert zu haben, weiß, dass jemand an seinem Konto war.",
  },
  {
    code: "AUSKUNFT_BEREIT",
    bezeichnung: "Datenauskunft nach Art. 15 DSGVO steht bereit",
    betreff: "Deine Datenauskunft der Gemeindebibelschule steht bereit",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "auf Anforderung wurde eine Auskunft über die zu dir gespeicherten Daten nach Art. 15 DSGVO " +
      "erstellt. Über den folgenden persönlichen Link kannst du sie als PDF herunterladen:\n\n" +
      "{{link}}\n\n" +
      "Der Link gilt {{gueltigkeit}} und führt zu deinen persönlichen Daten. Bitte gib ihn nicht weiter.\n\n" +
      "Hast du keine Auskunft angefordert, kannst du diese Nachricht ignorieren — ohne den Link wird nichts angezeigt.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Trägt nur den Abruf-Link, nie die Daten selbst — Glaubensangaben und IBAN dürfen den Mailkanal nicht verlassen.",
  },
  {
    code: "UEBERLEITUNG_EINLADUNG",
    bezeichnung: "Einladung ins Folgesemester (Re-Enrollment)",
    betreff: "Bist du im {{semester}} dabei?",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "das nächste Semester an der Gemeindebibelschule Minden steht an: {{semester}} " +
      "({{zeitraum}}).\n\n" +
      "Bist du wieder dabei? Ein Klick genügt:\n\n{{link}}\n\n" +
      "Möchtest du pausieren oder aussteigen, melde dich einfach bei der Schulleitung.\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Startet die Semesterüberleitung: geht an alle aktiven Teilnehmer des laufenden Semesters mit dem persönlichen „bin dabei\"-Link.",
  },
  {
    code: "UEBERLEITUNG_ERINNERUNG",
    bezeichnung: "Erinnerung an die Rückmeldung fürs Folgesemester",
    betreff: "Erinnerung: Bist du im {{semester}} dabei?",
    textMd:
      "Hallo {{vorname}},\n\n" +
      "kurze Erinnerung: Für {{semester}} ({{zeitraum}}) fehlt uns noch deine " +
      "Rückmeldung. Bist du dabei?\n\n{{link}}\n\n" +
      "Gemeindebibelschule Minden",
    beschreibung:
      "Automatische Erinnerung (T-14/-7/-3 vor Semesterstart) an alle, die noch nicht bestätigt haben. Denselben Link wie in der Einladung.",
  },
];

// -----------------------------------------------------------------------------
// Ermaessigungen
//
// Bewusst als Datensatz statt als Konstante im Code: Der Satz laesst sich ohne
// Deploy aendern, und weitere Faelle kommen ueber die Jahre dazu. Der
// Beitragslauf, der diese Saetze anwendet, entsteht mit Release 0.3.
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
// Unique-Index `semester_genau_ein_aktuelles`. `istAktuell` wird deshalb nur
// beim Anlegen gesetzt, nie in einem Re-Seed aktualisiert (siehe main()).
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
    await prisma.rolle.upsert({ where: { code: rolle.code }, update: rolle, create: rolle });

    // Die Matrix wird je Rolle neu gesetzt, damit entzogene Rechte auch
    // wirklich verschwinden und nicht als Altlast haengen bleiben.
    await prisma.rolleRecht.deleteMany({ where: { rolleCode: rolle.code } });
    if (rechte.length > 0) {
      await prisma.rolleRecht.createMany({
        data: rechte.map((rechtCode) => ({ rolleCode: rolle.code, rechtCode })),
      });
    }
  }

  console.log("[Seed] Einwilligungstexte...");
  for (const einwilligung of EINWILLIGUNGEN) {
    await prisma.einwilligungsText.upsert({
      where: { code_version: { code: einwilligung.code, version: einwilligung.version } },
      update: einwilligung,
      create: einwilligung,
    });
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

  console.log("[Seed] Ermaessigungen...");
  for (const ermaessigung of ERMAESSIGUNGEN) {
    await prisma.ermaessigung.upsert({
      where: { code: ermaessigung.code },
      update: ermaessigung,
      create: ermaessigung,
    });
  }

  console.log("[Seed] Semester...");
  for (const s of SEMESTER) {
    // `istAktuell` bewusst NICHT im update: Was der Betrieb als laufendes
    // Semester gesetzt hat, darf ein Seed-Lauf nach dem naechsten Deploy nicht
    // zuruecksetzen — und der partielle Unique-Index liesse zwei true-Zeilen
    // ohnehin nicht zu. Nur beim Erstanlegen wird 2026-H als laufend markiert.
    await prisma.semester.upsert({
      where: { code: s.code },
      update: {
        bezeichnung: s.bezeichnung,
        start: s.start,
        ende: s.ende,
        lehrjahr: s.lehrjahr,
        halbjahr: s.halbjahr,
      },
      create: s,
    });
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
  };
  console.log("[Seed] Fertig:", zahlen);
}

main()
  .catch((fehler) => {
    console.error("[Seed] Fehlgeschlagen:", fehler);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

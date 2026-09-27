/**
 * GBS Campus — zentrale Konstanten
 *
 * CLAUDE.md schreibt diese Datei vor, und der Grund ist kein Ordnungssinn:
 * Rollen-, Status-, Rechte- und Einwilligungs-Codes standen vorher als nackte
 * Strings in elf Dateien. Ein Tippfehler in `"ANMELDUNG_ENTSCHEIDEN"` erzeugt
 * keinen Compile-Fehler, sondern **lautlosen Rechteentzug** — die Seite ist
 * dann für alle gesperrt, ohne dass irgendwo etwas rot wird.
 *
 * Die Werte sind die Wahrheit aus `prisma/seed.ts`. Wer dort etwas ergänzt,
 * ergänzt es hier mit.
 */

/**
 * Name, Träger und Ort der Einrichtung — rechtswirksam auf Belegen, Zeugnissen
 * und in der Datenauskunft. Vorher stand der Name 24-mal und der Träger 7-mal
 * fest im Code; eine Umbenennung hätte Stellen übersehen. Der Wortlaut ist
 * byte-gleich zu den bisherigen Texten.
 */
export const EINRICHTUNG = {
  name: "Gemeindebibelschule Minden",
  traeger: "Christliches Werk Esra e.V.",
  ort: "Minden",
} as const;

export const ROLLE = {
  ADMIN: "ADMIN",
  SCHULLEITER: "SCHULLEITER",
  VERWALTUNG: "VERWALTUNG",
  TEILNEHMER: "TEILNEHMER",
  DOZENT: "DOZENT",
  GASTDOZENT: "GASTDOZENT",
} as const;
export type RolleCode = (typeof ROLLE)[keyof typeof ROLLE];

export const RECHT = {
  PERSON_LESEN_EIGENE: "PERSON_LESEN_EIGENE",
  PERSON_BEARBEITEN_EIGENE: "PERSON_BEARBEITEN_EIGENE",
  PERSON_LESEN_ALLE: "PERSON_LESEN_ALLE",
  PERSON_BEARBEITEN_ALLE: "PERSON_BEARBEITEN_ALLE",
  PERSON_STATUS_WECHSELN: "PERSON_STATUS_WECHSELN",
  PERSON_EXPORTIEREN: "PERSON_EXPORTIEREN",
  PERSON_ANONYMISIEREN: "PERSON_ANONYMISIEREN",
  SEMESTER_VERWALTEN: "SEMESTER_VERWALTEN",
  EIGENE_TERMINE_LESEN: "EIGENE_TERMINE_LESEN",
  ANWESENHEIT_ERFASSEN_EIGENE: "ANWESENHEIT_ERFASSEN_EIGENE",
  NOTEN_ERFASSEN_EIGENE: "NOTEN_ERFASSEN_EIGENE",
  NOTEN_VERWALTEN: "NOTEN_VERWALTEN",
  ANMELDUNG_LESEN: "ANMELDUNG_LESEN",
  ANMELDUNG_ENTSCHEIDEN: "ANMELDUNG_ENTSCHEIDEN",
  FORMULAR_BEARBEITEN: "FORMULAR_BEARBEITEN",
  FORMULAR_VEROEFFENTLICHEN: "FORMULAR_VEROEFFENTLICHEN",
  /** Noch ohne Funktion: Keine Route prüft dieses Recht (Seed-Bezeichnung sagt es). */
  MAIL_VERTEILER_SENDEN: "MAIL_VERTEILER_SENDEN",
  /** Noch ohne Funktion: Keine Route prüft dieses Recht. */
  MAIL_VORLAGEN_BEARBEITEN: "MAIL_VORLAGEN_BEARBEITEN",
  /** Noch ohne Funktion: Keine Route prüft dieses Recht. */
  FINANZ_DATEN_LESEN: "FINANZ_DATEN_LESEN",
  BANKVERBINDUNG_LESEN: "BANKVERBINDUNG_LESEN",
  HONORAR_LESEN: "HONORAR_LESEN",
  HONORAR_SATZ_GENEHMIGEN: "HONORAR_SATZ_GENEHMIGEN",
  HONORAR_ABRECHNEN: "HONORAR_ABRECHNEN",
  BENUTZER_VERWALTEN: "BENUTZER_VERWALTEN",
  SYSTEM_EINSTELLUNGEN: "SYSTEM_EINSTELLUNGEN",
  AUDIT_LESEN: "AUDIT_LESEN",
  /** Noch ohne Funktion: Keine Route prüft dieses Recht. */
  IMPERSONATION: "IMPERSONATION",
} as const;
export type RechtCode = (typeof RECHT)[keyof typeof RECHT];

/**
 * Die Zustände der Statusmaschine. Die Tabelle `teilnehmer_status` bleibt die
 * führende Quelle — hier stehen nur die Codes, die der Code selbst setzt, damit
 * sie sich nicht vertippen lassen. Neue Zustände kommen weiterhin ohne Deploy
 * in die Tabelle; sie müssen hier nur auftauchen, wenn Code sie direkt setzt.
 */
export const STATUS = {
  INTERESSENT: "INTERESSENT",
  ANGENOMMEN: "ANGENOMMEN",
  AKTIV: "AKTIV",
  BEURLAUBT: "BEURLAUBT",
  ABSOLVENT: "ABSOLVENT",
  ABGEBROCHEN: "ABGEBROCHEN",
  AUSGESCHLOSSEN: "AUSGESCHLOSSEN",
  VERSTORBEN: "VERSTORBEN",
  ANONYMISIERT: "ANONYMISIERT",
} as const;
export type StatusCode = (typeof STATUS)[keyof typeof STATUS];

export const EINWILLIGUNG = {
  DATENSCHUTZ: "DATENSCHUTZ",
  /** Besondere Kategorie nach Art. 9 DSGVO — Glaube und Gemeindezugehörigkeit. */
  GLAUBENSANGABEN: "GLAUBENSANGABEN",
  FOTOS: "FOTOS",
} as const;

export const MAIL_VORLAGE = {
  MAGIC_LINK: "MAGIC_LINK",
  ANMELDUNG_EINGEGANGEN: "ANMELDUNG_EINGEGANGEN",
  ANMELDUNG_ANGENOMMEN: "ANMELDUNG_ANGENOMMEN",
  ANMELDUNG_VERWALTUNG: "ANMELDUNG_VERWALTUNG",
  ANMELDUNG_DOPPELT: "ANMELDUNG_DOPPELT",
  DATENAENDERUNG_VERWALTUNG: "DATENAENDERUNG_VERWALTUNG",
  EMAIL_AENDERUNG_BESTAETIGEN: "EMAIL_AENDERUNG_BESTAETIGEN",
  EMAIL_AENDERUNG_HINWEIS: "EMAIL_AENDERUNG_HINWEIS",
  EMAIL_GEAENDERT_DURCH_VERWALTUNG: "EMAIL_GEAENDERT_DURCH_VERWALTUNG",
  PASSWORT_GEAENDERT: "PASSWORT_GEAENDERT",
  BANKVERBINDUNG_GEAENDERT: "BANKVERBINDUNG_GEAENDERT",
  EMAIL_AENDERUNG_ADRESSE_BELEGT: "EMAIL_AENDERUNG_ADRESSE_BELEGT",
  ANMELDUNG_DOPPELT_VERWALTUNG: "ANMELDUNG_DOPPELT_VERWALTUNG",
  ZUGANG_HILFE_MELDUNG: "ZUGANG_HILFE_MELDUNG",
  AUSKUNFT_BEREIT: "AUSKUNFT_BEREIT",
  UEBERLEITUNG_EINLADUNG: "UEBERLEITUNG_EINLADUNG",
  UEBERLEITUNG_ERINNERUNG: "UEBERLEITUNG_ERINNERUNG",
} as const;

/** Millisekunden — damit die Umrechnung nicht viermal ausgeschrieben im Code steht. */
export const MINUTE_MS = 60_000;
export const STUNDE_MS = 60 * MINUTE_MS;
export const TAG_MS = 24 * STUNDE_MS;

/**
 * Das dreijährige Kursraster: Lehrjahr 1–3, je zwei Halbjahre (1 = Herbst,
 * 2 = Frühling). Die Semesterprüfung (Wertebereich) und der Zeugnis-Sammellauf
 * (letztes Rastersemester) leiten ihre Grenzen hieraus ab.
 */
export const KURSRASTER = {
  LEHRJAHRE: 3,
  HALBJAHRE: 2,
} as const;

/**
 * Warum eine Teilnahme nicht (mehr) zählt — `Teilnahme.abmeldeGrund` bei
 * gesetztem `abgemeldetAm` (Semesterüberleitung). Dieselben zwei Werte erzwingt
 * der CHECK `teilnahmen_abmeldung_konsistent` in der Datenbank.
 */
export const ABMELDEGRUND = {
  /** Die Person hat über ihren Link „Ich bin raus" geantwortet. */
  BIN_RAUS: "BIN_RAUS",
  /** Eingeladen, aber bis zum Semesterstart keine Antwort (Worker). */
  KEINE_RUECKMELDUNG: "KEINE_RUECKMELDUNG",
} as const;
export type AbmeldegrundCode = (typeof ABMELDEGRUND)[keyof typeof ABMELDEGRUND];

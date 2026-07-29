/**
 * GBS Campus — Anonymisierung (DSGVO Art. 17): DB-freie Kernlogik
 *
 * „Anonymisieren statt Löschen": Audit-Log und Einwilligungen sind append-only
 * und müssen als Nachweis (Art. 7 Abs. 1) erhalten bleiben — der Datensatz wird
 * also nicht gelöscht, sondern alle personenbezogenen Felder werden
 * überschrieben. Hier stehen die reinen Werte-Funktionen ohne Datenbank, damit
 * `scripts/pruefe-anonymisierung.ts` sie ohne Postgres gegenprüfen kann.
 */

/** Platzhalter für ein überschriebenes Textfeld. */
export const ANONYM_PLATZHALTER = "[anonymisiert]";

/**
 * Eine eindeutige, nicht zustellbare Platzhalter-Adresse. `.invalid` ist laut
 * RFC 2606 reserviert und wird nie zugestellt; die Person-Id macht sie eindeutig
 * (die E-Mail-Spalte ist `@unique`, ein fester Text würde beim zweiten Mal
 * kollidieren).
 */
export function anonymEmail(personId: string): string {
  return `anonym-${personId}@anonymisiert.invalid`;
}

/**
 * Die Person-Felder nach der Anonymisierung. Alles, was eine Person
 * identifizierbar macht, wird überschrieben oder geleert; der Status wird auf
 * den Endzustand ANONYMISIERT gesetzt und die Ehepartner-Kopplung gelöst.
 */
export function anonymePersonFelder(personId: string) {
  return {
    vorname: "Anonymisiert",
    nachname: "Person",
    email: anonymEmail(personId),
    telefon: null,
    geburtsdatum: null,
    strasse: null,
    plz: null,
    ort: null,
    gemeinde: null,
    ibanVerschluesselt: null,
    kontoinhaber: null,
    passwortHash: null,
    passwortGeaendertAm: null,
    ehepartnerId: null,
    ermaessigungCode: null,
    teilnahmeform: null,
    notiz: null,
    statusCode: "ANONYMISIERT",
  };
}

/**
 * Überschreibt alle Antworten einer Anmeldung (Voll-Scrub): jeder Wert wird
 * durch den Platzhalter ersetzt. Die Struktur bleibt (welche Fragen gab es), der
 * Inhalt — Name, Adresse, IBAN, Glaubensangaben nach Art. 9 — verschwindet.
 */
export function scrubbeAntworten(antworten: Record<string, unknown>): Record<string, string> {
  const ergebnis: Record<string, string> = {};
  for (const schluessel of Object.keys(antworten)) {
    ergebnis[schluessel] = ANONYM_PLATZHALTER;
  }
  return ergebnis;
}

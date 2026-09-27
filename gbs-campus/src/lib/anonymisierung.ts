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
 * identifizierbar macht, wird überschrieben oder geleert und die
 * Ehepartner-Kopplung gelöst.
 *
 * Der Status steht bewusst NICHT hier: Er wechselt über `wechsleStatus`
 * (bedingt auf den gelesenen Status, mit StatusWechsel-Zeile) — sonst gäbe es
 * wieder eine zweite Stelle, die ihn schreibt.
 *
 * `passwortGeaendertAm` wird auf JETZT gesetzt, nicht geleert: Daran misst
 * `ladeAngemeldeten`, ob eine Sitzung älter ist als der letzte Zugangswechsel.
 * Leer griffe dieser Widerruf nicht, und die laufenden Sitzungen hingen allein
 * an `istTerminal` des Status.
 */
export function anonymePersonFelder(personId: string, jetzt: Date) {
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
    passwortGeaendertAm: jetzt,
    ehepartnerId: null,
    ermaessigungCode: null,
    teilnahmeform: null,
    notiz: null,
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

/**
 * Anonymisiert den eingefrorenen Snapshot eines Zeugnisses (Fachentscheidung:
 * ausgestellte Zeugnisse bleiben als Nachweis). Name und Geburtsdatum werden
 * überschrieben; Beleg-Nr., Fächer, Ergebnisse, Abschnitt und Aussteller
 * bleiben — das Zeugnis belegt danach noch, DASS es ausgestellt wurde, aber
 * nicht mehr, für wen.
 *
 * `person` wird als Ganzes ersetzt statt Feld für Feld: Kommt dort später ein
 * weiteres Feld hinzu (etwa eine Anschrift), fällt es hier automatisch mit weg.
 * Reine Funktion — das übergebene Objekt bleibt unverändert.
 */
export function scrubbeZeugnisSnapshot(snapshot: unknown): unknown {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  return { ...(snapshot as Record<string, unknown>), person: { name: ANONYM_PLATZHALTER, geburtsdatum: null } };
}

/**
 * Woran sich im Versandprotokoll ein Betreff erkennen lässt, der die Person
 * nennt — unabhängig davon, an wen die Mail ging. Ältere Verwaltungsmails
 * („Neue Anmeldung: Max Muster") hängen an der `personId` des EMPFÄNGERS und
 * würden über die Person-Id nie gefunden.
 *
 * Jede innere Liste muss vollständig im Betreff stehen (UND), die Listen sind
 * Alternativen (ODER). Vor- und Nachname nur gemeinsam — der Nachname allein
 * träfe Namensvettern. Leere Teile fallen weg: Ein leerer Suchbegriff träfe
 * jede Zeile.
 */
export function betreffSuchbegriffe(person: { vorname: string; nachname: string; email: string }): string[][] {
  const vorname = person.vorname.trim();
  const nachname = person.nachname.trim();
  const email = person.email.trim();
  const gruppen: string[][] = [];
  if (vorname.length > 0 && nachname.length > 0) gruppen.push([vorname, nachname]);
  if (email.includes("@")) gruppen.push([email]);
  return gruppen;
}

function gleicherWert(a: unknown, b: unknown): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x instanceof Date || y instanceof Date) {
    return x instanceof Date && y instanceof Date && x.getTime() === y.getTime();
  }
  return x === y;
}

/**
 * Audit ohne Klardaten (Code-Review 4, M6c): Das Audit-Log ist append-only —
 * was dort steht, erreicht keine Anonymisierung mehr. Bei Änderungen an
 * Personendaten gehören deshalb nur die NAMEN der geänderten Felder ins
 * Protokoll, nie die Werte (Name, Anschrift, Telefon, E-Mail, Geburtsdatum,
 * Gemeinde, IBAN).
 *
 * `undefined` in `nachher` heißt „nicht mitgeschickt" und ist keine Änderung;
 * `null` heißt „geleert" und ist eine. Daten werden nach Zeitwert verglichen.
 */
export function geaenderteFeldnamen(vorher: Record<string, unknown>, nachher: Record<string, unknown>): string[] {
  return Object.keys(nachher).filter((feld) => nachher[feld] !== undefined && !gleicherWert(vorher[feld], nachher[feld]));
}

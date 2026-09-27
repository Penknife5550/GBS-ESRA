/**
 * GBS Campus — Semesterbeitrag: Grundlagen für den künftigen Beitragslauf
 *
 * Der eigentliche Beitragslauf (Einzug, Rechnung) kommt in einem künftigen
 * Release. Hier steht nur, was heute schon gebraucht wird: die vier Beträge
 * liegen als konfigurierbare Einstellungen (siehe `EINSTELLUNGEN` in
 * `src/lib/einstellungen.ts`, Bereich BEITRAG), und bei der Aufnahme wird die
 * Ehepartner-Ermäßigung am Konto vermerkt, wenn die Anmeldung eine gemeinsame
 * Anmeldung mit dem Ehepartner angibt.
 *
 * Bewusst reines Modul ohne Datenbank-Import — so ist der Helfer per Prüfskript
 * ohne DB und mutationssicher testbar (Projektregel 2).
 */

/** Ermäßigungscode aus dem Seed (`ERMAESSIGUNGEN`), 50 % für den zweiten Ehepartner. */
export const ERMAESSIGUNG_EHEPARTNER = "EHEPARTNER";

/**
 * Feldcode im Bewerbungsformular, mit dem eine gemeinsame Anmeldung mit dem
 * Ehepartner angegeben wird (JA/NEIN). Ändert sich der Code im Formular, greift
 * die Ermäßigung nicht mehr — deshalb steht er hier zentral und nicht als
 * nackter String in der Aufnahme-Route.
 */
export const EHEPARTNER_FELD_CODE = "ehepartner_gemeinsam";

/**
 * Soll bei der Aufnahme die Ehepartner-Ermäßigung gesetzt werden? Wahr, wenn die
 * Anmeldung die gemeinsame Anmeldung bejaht. JA/NEIN-Antworten werden als
 * Boolean gespeichert (siehe `formular.ts`); die String-Varianten sind nur zur
 * Sicherheit gegen Altbestände abgedeckt.
 */
export function willEhepartnerErmaessigung(antworten: Record<string, unknown>): boolean {
  const wert = antworten[EHEPARTNER_FELD_CODE];
  return wert === true || wert === "true" || wert === "ja";
}

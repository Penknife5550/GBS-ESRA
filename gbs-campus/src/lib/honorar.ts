/**
 * GBS Campus — Dozentenhonorar: DB-freie Kernlogik
 *
 * Der Honorarsatz je Unterrichtsabend fuehrt eine Historie mit Gueltig-ab-Datum
 * (Modell `HonorarSatz`): jeder Abend nimmt den Satz, der zu seinem Datum galt.
 * Hier steht, was ohne Datenbank entscheidbar ist — die Auswahl des geltenden
 * Satzes und die Rechnung/Formatierung —, damit `scripts/pruefe-honorar.ts` es
 * ohne laufenden Postgres gegenpruefen kann. Der IO-Teil (Laden, Genehmigen,
 * DMS-Beleg) liegt in `honorar-io.ts`.
 */

/**
 * Rueckfallsatz, wenn die Historie (noch) leer ist oder ein Abend vor dem
 * ersten hinterlegten Satz liegt. Bewusst eine Konstante und kein
 * Datenbankwert: er greift nur, wenn gar kein genehmigter Satz vorliegt — eine
 * fehlende Historie darf die Uebersicht nicht mit 0 EUR verfaelschen. Entspricht
 * dem frueheren Standard der abgeloesten Einstellung HONORAR_SATZ_PRO_ABEND.
 */
export const HONORAR_SATZ_FALLBACK = 60;

/**
 * Grenzen des Honorarsatzes — im Code, nicht nur im Formular (wie bei den
 * Einstellungen). Liegen bei der DB-freien Kernlogik, damit Route und
 * IO-Prüfung dieselbe Quelle nutzen.
 */
export const HONORAR_SATZ_MIN = 0;
export const HONORAR_SATZ_MAX = 100000;

export type SatzZeile = { betrag: number; gueltigAb: Date; genehmigtAm?: Date };

/**
 * Der fuer ein Datum geltende Honorarsatz aus der Historie: die Zeile mit dem
 * groessten `gueltigAb`, das noch `<= datum` ist. Bei gleichem `gueltigAb`
 * gewinnt die zuletzt genehmigte Zeile (`genehmigtAm`) — so ueberschreibt eine
 * Korrektur den frueheren Eintrag, ohne dass Historie verlorengeht. Liegt das
 * Datum vor dem ersten Satz (oder ist die Historie leer), greift der
 * Rueckfallsatz.
 *
 * Die Eingabeliste darf unsortiert sein; die Funktion sucht selbst das Maximum.
 */
export function satzFuer(datum: Date, saetze: SatzZeile[]): number {
  let treffer: SatzZeile | null = null;
  for (const s of saetze) {
    if (s.gueltigAb.getTime() > datum.getTime()) continue; // gilt erst spaeter
    if (treffer === null) {
      treffer = s;
      continue;
    }
    const neuerIstSpaeter = s.gueltigAb.getTime() > treffer.gueltigAb.getTime();
    const gleichesDatumSpaeterGenehmigt =
      s.gueltigAb.getTime() === treffer.gueltigAb.getTime() &&
      (s.genehmigtAm?.getTime() ?? 0) >= (treffer.genehmigtAm?.getTime() ?? 0);
    if (neuerIstSpaeter || gleichesDatumSpaeterGenehmigt) treffer = s;
  }
  return treffer ? treffer.betrag : HONORAR_SATZ_FALLBACK;
}

/** Ganzzahliger Eurobetrag in deutscher Schreibweise, z. B. „1.260 €". */
export function euro(betrag: number): string {
  return `${new Intl.NumberFormat("de-DE").format(betrag)} €`;
}

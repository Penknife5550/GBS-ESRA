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

/**
 * Honorarbetrag eines Dozenten aus einer Liste von Abend-Betraegen. Beide Werte
 * sind ganzzahlig (Betraege in Euro), also ist auch die Summe ganzzahlig — keine
 * Rundung noetig. Weil verschiedene Abende zu verschiedenen Saetzen zaehlen
 * koennen, wird ueber die Abende summiert und nicht `Anzahl x ein Satz`.
 */
export function summiereBetraege(betraege: number[]): number {
  return betraege.reduce((s, b) => s + b, 0);
}

/**
 * Honorarbetrag bei einem einheitlichen Satz: Anzahl Abende x Satz. Gilt, wenn
 * fuer alle Abende eines Dozenten derselbe Satz greift (der Regelfall innerhalb
 * eines Semesters). Bleibt fuer die DB-freie Gegenprobe erhalten.
 */
export function honorarBetrag(abende: number, satz: number): number {
  return abende * satz;
}

/** Ganzzahliger Eurobetrag in deutscher Schreibweise, z. B. „1.260 €". */
export function euro(betrag: number): string {
  return `${new Intl.NumberFormat("de-DE").format(betrag)} €`;
}

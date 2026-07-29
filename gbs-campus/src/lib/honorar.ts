/**
 * GBS Campus — Dozentenhonorar: DB-freie Kernlogik
 *
 * Die Honorar-Übersicht (Release 0.2) ist bewusst schlicht: Anzahl der von einem
 * Dozenten gehaltenen Unterrichtsabende × Honorarsatz je Abend. Kein Beleg,
 * keine Freigabe, keine Auszahlung — das ist die Abrechnung, und die kommt mit
 * Release 0.3. Hier steht nur, was ohne Datenbank entscheidbar ist, damit
 * `scripts/pruefe-honorar.ts` es ohne laufenden Postgres gegenprüfen kann.
 */

/**
 * Honorarbetrag eines Dozenten: Anzahl gehaltener Abende × Satz. Beide Werte
 * sind ganzzahlig (Abende als Zählung, der Satz als Euro-Einstellung), also ist
 * auch das Ergebnis ganzzahlig — keine Rundung nötig. Null Abende ergeben null
 * Euro; ein Satz von 0 (in den Grenzen erlaubt) ebenso.
 */
export function honorarBetrag(abende: number, satz: number): number {
  return abende * satz;
}

/** Ganzzahliger Eurobetrag in deutscher Schreibweise, z. B. „1.260 €". */
export function euro(betrag: number): string {
  return `${new Intl.NumberFormat("de-DE").format(betrag)} €`;
}

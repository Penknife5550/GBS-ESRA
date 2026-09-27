/**
 * GBS Campus — Aufräumlauf: DB-freie Regel für das Lebenszeichen im Audit-Log
 *
 * Der Aufräumlauf läuft stündlich im Worker und zusätzlich höchstens stündlich
 * aus der App (`raeumeGelegentlichAuf`). Früher schrieb JEDER Lauf einen
 * Eintrag `AUFRAEUMEN_GELAUFEN` — rund 9.000 bis 12.000 Zeilen im Jahr in einer
 * append-only-Tabelle, die sich nie mehr verkleinern lässt, und in ruhigen
 * Wochen bestanden die neuesten Einträge der Protokollseite fast nur daraus.
 *
 * Die Aussage, die der Betrieb braucht („der Lauf lebt noch"), braucht diese
 * Frequenz nicht: Die Betriebsansicht warnt erst nach 48 Stunden. Deshalb wird
 * nur noch geschrieben, wenn etwas gelöscht wurde, beim ersten Lauf einer
 * Herkunft oder wenn der letzte Eintrag DIESER Herkunft mindestens zwölf Stunden
 * alt ist. Die Herkunft (WORKER bzw. APP) wird getrennt geführt, damit die
 * gelegentlichen Läufe der App das Lebenszeichen des Workers nicht vortäuschen.
 *
 * Bewusst ohne Datenbank, damit `scripts/pruefe-semesterlogik.ts` die
 * Grenzfälle ohne Postgres gegenprüft.
 */

import { STUNDE_MS } from "@/lib/constants";

/** Höchstens so lange bleibt ein Lauf ohne Löschungen ohne Audit-Eintrag. */
export const HEARTBEAT_ABSTAND_MS = 12 * STUNDE_MS;

/** Wer den Aufräumlauf angestoßen hat — steht als `objektId` im Audit-Eintrag. */
export type AufraeumHerkunft = "WORKER" | "APP";

/**
 * Soll dieser Lauf einen Audit-Eintrag `AUFRAEUMEN_GELAUFEN` schreiben?
 *
 * @param summe       wie viele Zeilen der Lauf insgesamt gelöscht bzw. entwertet hat
 * @param letzterLauf Zeitpunkt des letzten Eintrags DERSELBEN Herkunft (null = noch keiner)
 * @param jetzt       Zeitpunkt dieses Laufs
 */
export function heartbeatFaellig(eingabe: { summe: number; letzterLauf: Date | null; jetzt: Date }): boolean {
  if (eingabe.summe > 0) return true;
  if (!eingabe.letzterLauf) return true;
  return eingabe.jetzt.getTime() - eingabe.letzterLauf.getTime() >= HEARTBEAT_ABSTAND_MS;
}

/**
 * GBS Campus — Selbstbestätigung der Anwesenheit: DB-freie Kernlogik
 *
 * Ein Teilnehmer bestätigt in `/meine-daten` selbst, dass er an einem
 * Unterrichtsabend anwesend war oder ihn nachgearbeitet hat. Drei Regeln
 * entscheiden, ob das erlaubt ist — und alle drei sind bewusst hier, DB-frei,
 * damit `scripts/pruefe-selbstbestaetigung.ts` sie ohne laufenden Postgres
 * gegenprüfen kann.
 *
 *  1. **Nur zwei Zustände.** Ein Teilnehmer darf sich anwesend oder
 *     nachgearbeitet melden — nicht entschuldigt und nicht gefehlt. Ob eine
 *     Abwesenheit entschuldigt ist, entscheidet die Schule, nicht der
 *     Betroffene; „gefehlt" meldet sich niemand selbst.
 *  2. **Nur vergangene Abende.** Man bestätigt keine Anwesenheit im Voraus.
 *  3. **Nur den eigenen Eintrag.** Hat die Verwaltung für diesen Abend bereits
 *     etwas erfasst, ist das für den Teilnehmer schreibgeschützt — sonst könnte
 *     jemand ein administratives „gefehlt" mit einem selbst gesetzten „anwesend"
 *     überschreiben. Ein Eintrag, den der Teilnehmer selbst gesetzt hat, darf er
 *     dagegen ändern (etwa von „anwesend" auf „nachgearbeitet").
 */

/** Die beiden Zustände, die ein Teilnehmer für sich selbst setzen darf. */
export const SELBST_STATUS = ["ANWESEND", "NACHGEARBEITET"] as const;
export type SelbstStatus = (typeof SELBST_STATUS)[number];

/** Regel 1: Nur ANWESEND und NACHGEARBEITET sind Selbstbestätigungen. */
export function istSelbstStatusErlaubt(status: string): status is SelbstStatus {
  return (SELBST_STATUS as readonly string[]).includes(status);
}

/**
 * Regel 2: Ein Abend ist bestätigbar, sobald er begonnen hat — verglichen wird
 * der Zeitpunkt `beginn` gegen die Wanduhr. Ein Abend, der genau jetzt beginnt,
 * gilt bereits als vergangen (kein sinnvoller Grund, die exakte Sekunde
 * auszunehmen).
 */
export function terminVergangen(beginn: Date, jetzt: Date): boolean {
  return beginn.getTime() <= jetzt.getTime();
}

/**
 * Regel 3: Darf der Teilnehmer den vorhandenen Anwesenheitseintrag setzen oder
 * ändern? Ja, wenn es noch keinen gibt (`vorhandene === null`) oder wenn der
 * bestehende Eintrag von ihm selbst stammt. Ein von der Verwaltung erfasster
 * Eintrag (fremde oder fehlende `erfasstVonId`) bleibt für ihn schreibgeschützt.
 */
export function darfSelbstSetzen(
  vorhandene: { erfasstVonId: string | null } | null,
  eigeneId: string,
): boolean {
  if (vorhandene === null) return true;
  return vorhandene.erfasstVonId === eigeneId;
}

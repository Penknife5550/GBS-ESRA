/**
 * GBS Campus — Dozentenhonorar: DB-freie Kernlogik
 *
 * Der Honorarsatz je Unterrichtsabend fuehrt eine Historie mit Gueltig-ab-Datum
 * (Modell `HonorarSatz`): jeder Abend nimmt den Satz, der zu seinem Datum galt.
 * Hier steht, was ohne Datenbank entscheidbar ist — die Auswahl des geltenden
 * Satzes, die Posten-Bildung einer Abrechnung, die Beleg-Nummer und die
 * Rechnung/Formatierung —, damit `scripts/pruefe-honorar.ts` es ohne laufenden
 * Postgres gegenpruefen kann. Der IO-Teil (Laden, Genehmigen, DMS-Beleg) liegt in
 * `honorar-io.ts` bzw. `honorar-abrechnung-io.ts`.
 */

import type { HonorarAbrechnungStatus } from "@prisma/client";
import { belegNummer } from "@/lib/beleg-nr";

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

/** Ein gehaltener, noch nicht abgerechneter Abend, wie ihn die Abrechnung einfriert. */
export type OffenerAbend = { terminId: string; beginn: Date; fach: string | null };

/** Ein Posten einer Abrechnung — so wird er gespeichert (eingefroren). */
export type EingefrorenerPosten = { terminId: string; datum: Date; fach: string | null; betrag: number };

/**
 * Bildet die Posten einer Abrechnung: je Abend Datum, Fach und der Satz, der zu
 * SEINEM Datum galt (`satzFuer`) — nicht ein Satz fuer alle. Liegt ein Gueltig-ab
 * zwischen zwei Abenden, tragen sie in derselben Abrechnung verschiedene
 * Betraege; die Summe ist die Summe dieser Betraege. Was hier herauskommt, wird
 * gespeichert: Ein spaeter genehmigter (auch rueckdatierter) Satz aendert Posten
 * und Summe einer bestehenden Abrechnung nicht mehr.
 */
export function bauePosten(abende: OffenerAbend[], saetze: SatzZeile[]): { posten: EingefrorenerPosten[]; summe: number } {
  const posten = abende.map((a) => ({
    terminId: a.terminId,
    datum: a.beginn,
    fach: a.fach,
    betrag: satzFuer(a.beginn, saetze),
  }));
  const summe = posten.reduce((s, p) => s + p.betrag, 0);
  return { posten, summe };
}

/**
 * Eindeutige, im DMS wiederauffindbare Beleg-Nummer, z. B. HON-2026-07-30-1A2B3C4D
 * (Satz-Genehmigung) bzw. HONA-… (Abrechnungs-Freigabe). Die Regel (Berliner
 * Kalendertag, acht Zeichen Zufall) steht fuer alle Belege in `beleg-nr.ts`.
 */
export function honorarBelegNr(praefix: "HON" | "HONA", am: Date, zufall: string): string {
  return belegNummer(praefix, am, zufall);
}

/** Ganzzahliger Eurobetrag in deutscher Schreibweise, z. B. „1.260 €". */
export function euro(betrag: number): string {
  return `${new Intl.NumberFormat("de-DE").format(betrag)} €`;
}

/**
 * Menschlicher Text zum Abrechnungsstatus. Hier (DB-frei) statt in
 * honorar-abrechnung-io.ts, damit auch der Badge in components/ui ihn nutzen
 * kann, ohne Prisma ins Browser-Bundle zu ziehen; honorar-abrechnung-io.ts
 * reicht ihn für bestehende Aufrufer weiter.
 */
export function abrechnungStatusText(status: HonorarAbrechnungStatus): string {
  switch (status) {
    case "OFFEN":
      return "Offen";
    case "FREIGEGEBEN":
      return "Freigegeben zur Auszahlung";
    case "AUSGEZAHLT":
      return "Ausgezahlt";
  }
}

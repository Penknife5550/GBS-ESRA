/**
 * GBS Campus — Leistungen & Noten: DB-freie Kernlogik
 *
 * Reine Funktionen ohne Datenbank, damit `scripts/pruefe-leistung.ts` sie ohne
 * Postgres gegenprüfen kann: die erlaubten Ergebnisse und die Prüfung einer
 * Bewertungseingabe (Ergebnis + optionale Punkte + optionale Note).
 *
 * Die Bewertung ist bewusst flexibel: Pflicht ist nur das `ergebnis`; `punkte`
 * und `note` sind optionale Zusatzangaben — real wird nur Bibelkunde benotet,
 * der Rest verbal.
 */

import { z } from "zod";

/** Die vier Leistungsergebnisse als Werte (parallel zum Prisma-Enum). */
export const LEISTUNGSERGEBNIS = {
  TEILGENOMMEN: "TEILGENOMMEN",
  ERFOLGREICH_TEILGENOMMEN: "ERFOLGREICH_TEILGENOMMEN",
  BESTANDEN: "BESTANDEN",
  NICHT_BESTANDEN: "NICHT_BESTANDEN",
} as const;

/** Als Tupel für z.enum in den Routen und die Reihenfolge in der Oberfläche. */
export const LEISTUNG_ERGEBNISSE = [
  "TEILGENOMMEN",
  "ERFOLGREICH_TEILGENOMMEN",
  "BESTANDEN",
  "NICHT_BESTANDEN",
] as const;

export type Leistungsergebniswert = (typeof LEISTUNG_ERGEBNISSE)[number];

export function istErgebnisErlaubt(ergebnis: string): ergebnis is Leistungsergebniswert {
  return (LEISTUNG_ERGEBNISSE as readonly string[]).includes(ergebnis);
}

/** Klartext für die Anzeige. */
export function ergebnisName(ergebnis: string | null | undefined): string {
  switch (ergebnis) {
    case "TEILGENOMMEN":
      return "teilgenommen";
    case "ERFOLGREICH_TEILGENOMMEN":
      return "erfolgreich teilgenommen";
    case "BESTANDEN":
      return "bestanden";
    case "NICHT_BESTANDEN":
      return "nicht bestanden";
    default:
      return "—";
  }
}

/**
 * Grenzen der optionalen Punktzahl. Bewusst großzügig (0-100): deckt sowohl eine
 * 0-15-Punkte-Skala als auch eine Prozentwertung ab. Die eigentliche Note trägt
 * das freie `note`-Feld.
 */
export const PUNKTE_MIN = 0;
export const PUNKTE_MAX = 100;

/** Maximale Länge der freien Notenangabe (z. B. „nicht bestanden (Nachschreiben)"). */
export const NOTE_MAX_LAENGE = 40;

/** Punktzahl gültig: ganzzahlig und innerhalb der Grenzen. */
export function punkteGueltig(punkte: number): boolean {
  return Number.isInteger(punkte) && punkte >= PUNKTE_MIN && punkte <= PUNKTE_MAX;
}

/** Freie Notenangabe normalisieren: trimmen, Leerstring → null. */
export function noteNormalisiert(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const gekuerzt = note.trim();
  return gekuerzt === "" ? null : gekuerzt;
}

export type LeistungEingabe = {
  ergebnis: string;
  punkte?: number | null;
  note?: string | null;
};

export type LeistungNormal = {
  ergebnis: Leistungsergebniswert;
  punkte: number | null;
  note: string | null;
};

export type LeistungFehler = "ergebnis" | "punkte" | "note";

/**
 * Prüft und normalisiert eine einzelne Bewertungseingabe. Einziger Ort der
 * fachlichen Regeln — die Routen validieren strukturell (Zod), diese Funktion
 * ist die DB-frei prüfbare Wahrheit und wird zusätzlich im IO-Layer aufgerufen
 * (Verteidigung in der Tiefe, wie `istDozentStatusErlaubt` bei der Anwesenheit).
 *
 *  - `ergebnis` muss eines der vier erlaubten sein, sonst `{ fehler: "ergebnis" }`.
 *  - `punkte` ist optional; wenn gesetzt, muss es ganzzahlig in [0, 100] liegen.
 *  - `note` ist optional; leer/Leerstring wird zu null, sonst getrimmt und auf
 *    die Maximallänge begrenzt.
 */
export function pruefeLeistung(eingabe: LeistungEingabe): { wert: LeistungNormal } | { fehler: LeistungFehler } {
  if (!istErgebnisErlaubt(eingabe.ergebnis)) return { fehler: "ergebnis" };

  let punkte: number | null = null;
  if (eingabe.punkte !== null && eingabe.punkte !== undefined) {
    if (!punkteGueltig(eingabe.punkte)) return { fehler: "punkte" };
    punkte = eingabe.punkte;
  }

  const note = noteNormalisiert(eingabe.note);
  if (note !== null && note.length > NOTE_MAX_LAENGE) return { fehler: "note" };

  return { wert: { ergebnis: eingabe.ergebnis, punkte, note } };
}

/**
 * Zod-Schema eines einzelnen Bewertungs-Eintrags — geteilt von den beiden
 * Noten-Routen (`/api/dozent/note`, `/api/noten`), deren Rumpf-Form identisch
 * ist. Spiegelt die fachlichen Grenzen aus `pruefeLeistung` strukturell; die
 * Route umschließt es nur noch mit `{ kurseinheitId, semesterId, eintraege[] }`.
 */
export const leistungEintragSchema = z.object({
  teilnahmeId: z.string().uuid(),
  ergebnis: z.enum(LEISTUNG_ERGEBNISSE),
  punkte: z.number().int().min(PUNKTE_MIN).max(PUNKTE_MAX).nullish(),
  note: z.string().trim().max(NOTE_MAX_LAENGE).nullish(),
});

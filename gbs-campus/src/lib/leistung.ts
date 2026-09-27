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
 *
 * Bewusst ohne zod: Die Datei landet über die Oberfläche (Notenmatrix,
 * Detailakte, Ergebnis-Badge) im Browser-Bundle. Das Zod-Schema der Noten-Routen
 * liegt deshalb in `leistung-schema.ts`.
 */

/** Die vier Leistungsergebnisse (parallel zum Prisma-Enum) — als Tupel für z.enum
 * in den Routen und die Reihenfolge in der Oberfläche. */
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

/**
 * Welche Ergebnisse als „bestanden" zählen (grün). Zentral, damit die
 * Personen-Liste („X/Y bestanden") und das ErgebnisBadge dieselbe Wahrheit nutzen
 * und ein künftiges fünftes Ergebnis nicht still an einer Kopie vorbeiläuft.
 */
export const BESTANDEN_ERGEBNISSE = ["BESTANDEN", "ERFOLGREICH_TEILGENOMMEN"] as const;

export function giltAlsBestanden(ergebnis: string | null | undefined): boolean {
  return ergebnis != null && (BESTANDEN_ERGEBNISSE as readonly string[]).includes(ergebnis);
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
 * Die Auswahlliste der Oberfläche (Notenmatrix, Detailakte): Reihenfolge wie im
 * Modell, Klartext aus `ergebnisName` — eine Quelle statt lokaler Kopien, die
 * ein künftiges Ergebnis still auslassen könnten.
 */
export const ERGEBNIS_OPTIONEN: readonly { wert: Leistungsergebniswert; label: string }[] = LEISTUNG_ERGEBNISSE.map(
  (wert) => ({ wert, label: ergebnisName(wert) }),
);

/** Eine gespeicherte Bewertung, wie die Ladeansichten sie an die Oberfläche geben
 * (Notenmatrix, Detailakte). `ergebnis` bleibt ein string — der Wert kommt aus
 * der Datenbank. */
export type LeistungWert = { ergebnis: string; punkte: number | null; note: string | null };

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

// -----------------------------------------------------------------------------
// Wer benotet wird — Hörer und Abgemeldete nicht
// -----------------------------------------------------------------------------

/**
 * Wird eine Teilnahme dieser Form benotet? Nur Schüler. Bauregel: Der Hörer
 * fällt aus jeder Prüfungsautomatik (Notenmatrix, Prüfungserinnerung,
 * Zeugnislauf) — er bekommt eine Teilnahmebescheinigung, die ihre Fächer aus
 * den Unterrichtsabenden baut, nicht aus Noten.
 */
export function wirdBenotet(teilnahmeform: string): boolean {
  return teilnahmeform === "SCHUELER";
}

export type NotenZiel = { id: string; teilnahmeform: string; abgemeldetAm: Date | null };
export type NotenZielFehler = "hoerer" | "abgemeldet";

/**
 * Welche Einträge einer Notenerfassung dürfen geschrieben werden? `ziele` sind
 * die Teilnahmen des Semesters. Ein Eintrag für eine semesterfremde Teilnahme
 * wird wie bisher still übersprungen (Whitelist). Ein Eintrag für einen Hörer
 * oder für eine für das Semester abgemeldete Teilnahme lehnt die GANZE
 * Erfassung ab — beide stehen in keiner Notenmatrix, ein solcher Eintrag ist
 * also nie ein Versehen der Oberfläche, sondern ein falscher Aufruf.
 */
export function pruefeNotenZiele(
  teilnahmeIds: string[],
  ziele: NotenZiel[],
): { gueltig: Set<string> } | { fehler: NotenZielFehler } {
  const zuId = new Map(ziele.map((z) => [z.id, z]));
  const gueltig = new Set<string>();
  for (const id of teilnahmeIds) {
    const ziel = zuId.get(id);
    if (!ziel) continue;
    if (!wirdBenotet(ziel.teilnahmeform)) return { fehler: "hoerer" };
    if (ziel.abgemeldetAm !== null) return { fehler: "abgemeldet" };
    gueltig.add(id);
  }
  return { gueltig };
}

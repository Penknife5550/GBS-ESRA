/**
 * GBS Campus — Fächer- und Kursraster-Helfer (DB-frei)
 *
 * Reine Darstellungs-/Sortierlogik ohne Datenbank, damit sie sich in
 * `scripts/pruefe-faecher.ts` ohne Postgres gegenprüfen lässt. Die Daten kommen
 * aus der Tabelle `kurseinheiten` bzw. aus `prisma/kursraster-definition.ts`.
 */

/** Halbjahr als Text: 1 = Herbst, 2 = Frühling. */
export function halbjahrName(halbjahr: number | null | undefined): string {
  if (halbjahr === 1) return "Herbst";
  if (halbjahr === 2) return "Frühling";
  return "";
}

/** Lehrjahr als Text, z. B. „1. Lehrjahr". Leer bei ungültiger Angabe. */
export function lehrjahrName(lehrjahr: number | null | undefined): string {
  if (typeof lehrjahr === "number" && lehrjahr >= 1) return `${lehrjahr}. Lehrjahr`;
  return "";
}

export type Kurs = {
  fachCode: string;
  fachBezeichnung: string;
  titel: string;
  jahrgangsjahr: number;
  halbjahr: number;
  stunden: number | null;
};

/**
 * Sortiert Kurseinheiten stabil: erst Lehrjahr, dann Halbjahr, dann die
 * fachliche Reihenfolge (sortierung), dann Titel. Damit sehen Ansicht, Export
 * und Prüfskript dieselbe Reihenfolge.
 */
export function sortiereKurse<T extends { jahrgangsjahr: number; halbjahr: number; sortierung?: number; titel: string }>(
  kurse: T[],
): T[] {
  return [...kurse].sort(
    (a, b) =>
      a.jahrgangsjahr - b.jahrgangsjahr ||
      a.halbjahr - b.halbjahr ||
      (a.sortierung ?? 0) - (b.sortierung ?? 0) ||
      a.titel.localeCompare(b.titel, "de"),
  );
}

export type RasterHalbjahr = { halbjahr: number; kurse: Kurs[] };
export type RasterLehrjahr = { lehrjahr: number; halbjahre: RasterHalbjahr[] };

/**
 * Gruppiert Kurse zum Anzeigeraster: Lehrjahr → Halbjahr → Kurse, jeweils
 * aufsteigend sortiert. Die Gesamtzahl der Kurse bleibt erhalten (kein Kurs geht
 * verloren, keiner entsteht doppelt).
 */
export function gruppiereRaster(kurse: (Kurs & { sortierung?: number })[]): RasterLehrjahr[] {
  const nachLehrjahr = new Map<number, Map<number, Kurs[]>>();
  for (const k of sortiereKurse(kurse)) {
    const halbjahre = nachLehrjahr.get(k.jahrgangsjahr) ?? new Map<number, Kurs[]>();
    const liste = halbjahre.get(k.halbjahr) ?? [];
    liste.push(k);
    halbjahre.set(k.halbjahr, liste);
    nachLehrjahr.set(k.jahrgangsjahr, halbjahre);
  }

  return [...nachLehrjahr.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lehrjahr, halbjahre]) => ({
      lehrjahr,
      halbjahre: [...halbjahre.entries()]
        .sort(([a], [b]) => a - b)
        .map(([halbjahr, kurse]) => ({ halbjahr, kurse })),
    }));
}

/**
 * GBS Campus — kleine Texthelfer für Abende (Teilnehmer- und Dozentenseiten)
 *
 * DB-frei. Die Datumsbausteine kommen aus `lib/datum.ts` (immer Europe/Berlin).
 */

import { tagKurz, tagLang } from "@/lib/datum";

/**
 * Der kurze Teil eines Themas für Listen und Karten: „Genesis 12–50: Die
 * Erzväter“ → „Genesis 12–50“. Ohne Doppelpunkt bleibt das Thema, wie es ist.
 */
export function kurzThema(thema: string | null | undefined): string | null {
  const text = thema?.trim();
  if (!text) return null;
  const teil = text.split(":")[0].trim();
  return teil || text;
}

/** „Dienstag, 22.09.“ — Wochentag ausgeschrieben, Datum kurz. */
export function tagMitName(d: Date): string {
  const wochentag = tagLang(d).split(",")[0];
  const datum = tagKurz(d).split(" ").pop() ?? "";
  return `${wochentag}, ${datum}`;
}

/** „Dienstag“ — für „Waren Sie am Dienstag da?“. */
export function wochentag(d: Date): string {
  return tagLang(d).split(",")[0];
}

/** „22.09.“ */
export function tagDatum(d: Date): string {
  return tagKurz(d).split(" ").pop() ?? "";
}

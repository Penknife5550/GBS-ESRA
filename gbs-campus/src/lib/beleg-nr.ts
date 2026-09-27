/**
 * GBS Campus — Beleg-Nummern (DB-frei)
 *
 * Eine Regel für alle Belege, die ins DMS gehen: Honorarsatz (HON),
 * Zahlungsbeleg (HONA), Zeugnis (ZEU) und Bescheinigung (BESCH), z. B.
 * „HON-2026-07-30-1A2B3C4D". Vorher stand sie mit eigener Datumsformatierung
 * in honorar.ts und zeugnis.ts.
 *
 * Das Datum ist der BERLINER Kalendertag von `am` — nicht `toISOString()`: das
 * rechnet in UTC und gäbe einem Beleg zwischen 0 und 2 Uhr den Vortag. Von
 * `zufall` (z. B. einer UUID) werden die ersten acht Zeichen groß übernommen;
 * der Zufall wird hereingereicht, damit die Regel ohne Datenbank prüfbar bleibt
 * (`scripts/pruefe-honorar.ts`, `scripts/pruefe-zeugnis.ts`).
 */

import { berlinerTag } from "@/lib/datum";

export function belegNummer(praefix: string, am: Date, zufall: string): string {
  return `${praefix}-${berlinerTag(am)}-${zufall.slice(0, 8).toUpperCase()}`;
}

/**
 * GBS Campus — Leistungen & Noten: Zod-Schema der Noten-Routen
 *
 * Eigene Datei, damit zod nicht über `leistung.ts` ins Browser-Bundle gerät:
 * `leistung.ts` wird von Client-Komponenten (Notenmatrix, Detailakte,
 * Ergebnis-Badge) importiert, dieses Schema nur von den beiden Routen.
 */

import { z } from "zod";
import { LEISTUNG_ERGEBNISSE, NOTE_MAX_LAENGE, PUNKTE_MAX, PUNKTE_MIN } from "@/lib/leistung";

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

import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { leistungEintragSchema } from "@/lib/leistung";
import { erfasseNote } from "@/lib/leistung-io";

// Gleiche Rumpfform wie /api/dozent/note (leistungEintragSchema) — hier ohne
// Fach-Scope: die Schulleitung (Recht NOTEN_VERWALTEN) verwaltet alle Fächer.
const schema = z.object({
  kurseinheitId: z.string().uuid(),
  semesterId: z.string().uuid(),
  eintraege: z.array(leistungEintragSchema).min(1).max(500),
});

/**
 * Die Schulleitung erfasst Noten für eine Kurseinheit eines Semesters, alle
 * Fächer (Recht NOTEN_VERWALTEN — bewusst nicht bei der Verwaltung).
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await erfasseNote(
    geprueft.data.kurseinheitId,
    geprueft.data.semesterId,
    geprueft.data.eintraege,
    benutzer.id,
    request.headers,
  );

  if ("fehler" in ergebnis) {
    switch (ergebnis.fehler) {
      case "kontext_fehlt":
        return fehler("Diese Kurseinheit gibt es in diesem Semester nicht.", 404);
      case "ungueltig":
        return fehler("Die Bewertung ist ungültig.", 400);
      default:
        return fehler("Die Noten konnten nicht gespeichert werden.", 500);
    }
  }

  return erfolg(ergebnis);
}

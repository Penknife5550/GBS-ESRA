import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, mitFehlerbehandlung, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { leistungEintragSchema } from "@/lib/leistung-schema";
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
  const benutzer = await pruefeZugriff(RECHT.NOTEN_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  return mitFehlerbehandlung("NOTEN", "Die Noten konnten nicht gespeichert werden.", async () => {
    const ergebnis = await erfasseNote({
      kurseinheitId: geprueft.data.kurseinheitId,
      semesterId: geprueft.data.semesterId,
      eintraege: geprueft.data.eintraege,
      akteurId: benutzer.id,
      headers: request.headers,
    });

    if ("fehler" in ergebnis) {
      switch (ergebnis.fehler) {
        case "kontext_fehlt":
          return fehler("Diese Kurseinheit gibt es in diesem Semester nicht.", 404);
        case "ungueltig":
          return fehler("Die Bewertung ist ungültig.", 400);
        case "hoerer":
          // Bauregel: Hörer fallen aus jeder Prüfungsautomatik — sie bekommen eine
          // Teilnahmebescheinigung, keine Noten.
          return fehler("Hörer werden nicht benotet — sie bekommen eine Teilnahmebescheinigung.", 400);
        case "abgemeldet":
          return fehler("Diese Teilnahme ist für das Semester abgemeldet — Noten lassen sich nicht erfassen.", 409);
        default:
          return nieErreicht(ergebnis.fehler);
      }
    }

    return erfolg(ergebnis);
  });
}

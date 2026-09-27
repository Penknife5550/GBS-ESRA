import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, mitFehlerbehandlung, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { leistungEintragSchema } from "@/lib/leistung-schema";
import { erfasseNoteAlsDozent } from "@/lib/leistung-io";

// Ergebnis Pflicht, Punkte/Note optional (leistungEintragSchema). Die strukturelle
// Prüfung spiegelt die fachliche in `pruefeLeistung`; der eigentliche Schutz ist
// der Scope-Guard (der Abend gehört dem Dozenten) in `erfasseNoteAlsDozent`.
const schema = z.object({
  kurseinheitId: z.string().uuid(),
  semesterId: z.string().uuid(),
  eintraege: z.array(leistungEintragSchema).min(1).max(500),
});

/**
 * Der Dozent erfasst Noten für eine seiner eigenen Kurseinheiten. Das Recht
 * öffnet die Route; der eigentliche Schutz ist der Scope-Guard
 * (`dozentId` an einem Abend zu Kurseinheit und Semester) in `erfasseNoteAlsDozent`.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.NOTEN_ERFASSEN_EIGENE);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  return mitFehlerbehandlung("NOTEN", "Die Noten konnten nicht gespeichert werden.", async () => {
    const ergebnis = await erfasseNoteAlsDozent({
      dozentId: benutzer.id,
      kurseinheitId: geprueft.data.kurseinheitId,
      semesterId: geprueft.data.semesterId,
      eintraege: geprueft.data.eintraege,
      headers: request.headers,
    });

    if ("fehler" in ergebnis) {
      switch (ergebnis.fehler) {
        case "kontext_fehlt":
          return fehler("Diese Kurseinheit gibt es in diesem Semester nicht.", 404);
        case "fremd":
          return fehler("Dieses Fach gehört nicht zu deinem Unterricht.", 403);
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

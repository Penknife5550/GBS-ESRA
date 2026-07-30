import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { leistungEintragSchema } from "@/lib/leistung";
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
  const benutzer = await ladeMitRecht(RECHT.NOTEN_ERFASSEN_EIGENE);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await erfasseNoteAlsDozent(
    benutzer.id,
    geprueft.data.kurseinheitId,
    geprueft.data.semesterId,
    geprueft.data.eintraege,
    request.headers,
  );

  if ("fehler" in ergebnis) {
    switch (ergebnis.fehler) {
      case "kontext_fehlt":
        return fehler("Diese Kurseinheit gibt es in diesem Semester nicht.", 404);
      case "fremd":
        return fehler("Dieses Fach gehört nicht zu deinem Unterricht.", 403);
      case "ungueltig":
        return fehler("Die Bewertung ist ungültig.", 400);
      default:
        return fehler("Die Noten konnten nicht gespeichert werden.", 500);
    }
  }

  return erfolg(ergebnis);
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, mitFehlerbehandlung, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { DOZENT_STATUS } from "@/lib/stundenplan";
import { erfasseAlsDozent } from "@/lib/stundenplan-io";

// Nur die drei Dozenten-Zustände (Quelle: DOZENT_STATUS) — „entschuldigt"
// entscheidet die Schule und wird schon hier mit 400 abgewiesen. Der Scope
// (der Abend gehört dem Dozenten) prüft die Fachlogik.
const schema = z.object({
  terminId: z.string().uuid(),
  eintraege: z
    .array(z.object({ teilnahmeId: z.string().uuid(), status: z.enum(DOZENT_STATUS) }))
    .min(1)
    .max(500),
});

/**
 * Der Dozent erfasst die Anwesenheit für einen seiner eigenen Unterrichtsabende.
 * Das Recht öffnet die Route; der eigentliche Schutz ist der Scope-Guard
 * `termin.dozentId === benutzer.id` in `erfasseAlsDozent`.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.ANWESENHEIT_ERFASSEN_EIGENE);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  return mitFehlerbehandlung("ANWESENHEIT", "Die Anwesenheit konnte nicht gespeichert werden.", async () => {
    const ergebnis = await erfasseAlsDozent({
      dozentId: benutzer.id,
      terminId: geprueft.data.terminId,
      eintraege: geprueft.data.eintraege,
      headers: request.headers,
    });

    if ("fehler" in ergebnis) {
      switch (ergebnis.fehler) {
        case "termin_fehlt":
          return fehler("Diesen Unterrichtsabend gibt es nicht.", 404);
        case "fremd":
          return fehler("Dieser Abend gehört nicht zu deinem Unterricht.", 403);
        case "zukunft":
          return fehler("Dieser Abend hat noch nicht stattgefunden.", 409);
        case "status_ungueltig":
          return fehler("Erlaubt sind nur anwesend, gefehlt und nachgearbeitet.", 400);
        default:
          return nieErreicht(ergebnis.fehler);
      }
    }

    return erfolg(ergebnis);
  });
}

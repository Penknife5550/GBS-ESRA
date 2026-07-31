import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { GEWAEHLTE_TYPEN } from "@/lib/zeugnis";
import { stelleSemesterZeugnisseAus, stelleZeugnisAus } from "@/lib/zeugnis-io";

// Mit personId = Einzel-Ausstellung/Neuausstellung (mit Storno des bestehenden),
// ohne = Sammellauf für alle aktiven Teilnehmer des Semesters (idempotent).
const schema = z.object({
  semesterId: z.string().uuid(),
  typ: z.enum(GEWAEHLTE_TYPEN),
  personId: z.string().uuid().optional(),
});

/**
 * Stellt Zeugnisse aus (Schulleitung, Recht NOTEN_VERWALTEN) — einzeln oder als
 * Sammellauf je Semester. Die Ausstellung friert den aktuellen Notenstand als
 * Snapshot ein; eine Neuausstellung storniert das vorige Zeugnis.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);
  const { semesterId, typ, personId } = geprueft.data;

  if (personId) {
    const ergebnis = await stelleZeugnisAus(personId, typ, semesterId, benutzer.id, request.headers);
    if ("fehler" in ergebnis) {
      switch (ergebnis.fehler) {
        case "person_fehlt":
          return fehler("Diese Person gibt es nicht.", 404);
        case "semester_fehlt":
          return fehler("Dieses Semester gibt es nicht.", 404);
        case "nicht_eingeschrieben":
          return fehler("Diese Person ist in diesem Semester nicht eingeschrieben.", 409);
        case "gleichzeitig":
          return fehler("Es wurde zeitgleich schon ein Zeugnis ausgestellt. Bitte neu laden.", 409);
        default:
          return fehler("Das Zeugnis konnte nicht ausgestellt werden.", 500);
      }
    }
    return erfolg({ zeugnisId: ergebnis.zeugnisId, belegNr: ergebnis.belegNr, version: ergebnis.version });
  }

  const ergebnis = await stelleSemesterZeugnisseAus(semesterId, typ, benutzer.id, request.headers);
  return erfolg(ergebnis);
}

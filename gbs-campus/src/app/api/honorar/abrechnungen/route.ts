import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { erstelleAbrechnung } from "@/lib/honorar-abrechnung-io";
import { statusFuer } from "@/lib/honorar-korrektur";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({
  dozentId: z.string().min(1),
  semesterId: z.string().min(1),
  // Was die Rückfrage genannt hat (Stand beim Seitenaufruf). Die Oberfläche
  // schickt beides immer mit; weicht der Stand beim Klick ab, 409.
  erwarteteAbende: z.number().int().min(0).optional(),
  erwarteteSumme: z.number().int().min(0).optional(),
});

/**
 * Erstellt eine Honorar-Abrechnung (friert die offenen gehaltenen Abende des
 * Dozenten im Semester ein). Die Fachlogik liegt in `erstelleAbrechnung`.
 * Fachliches Nein: 400 (keine offenen Abende), 409 (zwischenzeitlich abgerechnet
 * oder umgehängt, oder Abende/Summe weichen von der bestätigten Rückfrage ab).
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_ABRECHNEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  let ergebnis;
  try {
    const { erwarteteAbende, erwarteteSumme } = geprueft.data;
    ergebnis = await erstelleAbrechnung(
      geprueft.data.dozentId,
      geprueft.data.semesterId,
      benutzer.id,
      request.headers,
      erwarteteAbende !== undefined && erwarteteSumme !== undefined
        ? { abende: erwarteteAbende, summe: erwarteteSumme }
        : undefined,
    );
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Erstellen fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht erstellt werden. Bitte versuche es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, statusFuer(ergebnis.code));
  return erfolg({ abrechnungId: ergebnis.abrechnungId, abende: ergebnis.abende, summe: ergebnis.summe }, 201);
}

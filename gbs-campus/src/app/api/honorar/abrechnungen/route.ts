import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { erstelleAbrechnung } from "@/lib/honorar-abrechnung-io";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";

const schema = z.object({
  dozentId: z.string().min(1),
  semesterId: z.string().min(1),
});

/**
 * Erstellt eine Honorar-Abrechnung (friert die offenen gehaltenen Abende des
 * Dozenten im Semester ein). Die Fachlogik liegt in `erstelleAbrechnung`.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  let ergebnis;
  try {
    ergebnis = await erstelleAbrechnung(geprueft.data.dozentId, geprueft.data.semesterId, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Erstellen fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht erstellt werden. Bitte versuche es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, 400);
  return erfolg({ abrechnungId: ergebnis.abrechnungId, abende: ergebnis.abende, summe: ergebnis.summe }, 201);
}

import { NextRequest } from "next/server";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { storniereAbrechnung } from "@/lib/honorar-abrechnung-io";
import { statusFuer } from "@/lib/honorar-korrektur";
import { erfolg, fehler } from "@/lib/api";

/**
 * Storniert eine OFFENE Abrechnung (M11): Sie wird gelöscht, ihre Posten per
 * Cascade mit, die Abende sind wieder offen. Korrekturweg für einen falsch
 * zugeordneten Abend — erst stornieren, dann im Stundenplan umhängen, dann neu
 * abrechnen. Eine freigegebene oder ausgezahlte Abrechnung ist nicht stornierbar
 * (409); die Fachlogik liegt in `storniereAbrechnung`.
 */
export async function DELETE(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_ABRECHNEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;

  let ergebnis;
  try {
    ergebnis = await storniereAbrechnung(id, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Storno fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht storniert werden. Bitte versuche es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, statusFuer(ergebnis.code));
  return erfolg({ storniert: true, abende: ergebnis.abende, summe: ergebnis.summe });
}

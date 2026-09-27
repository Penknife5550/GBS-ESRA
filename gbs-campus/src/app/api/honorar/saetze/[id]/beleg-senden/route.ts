import { NextRequest } from "next/server";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { sendeSatzBelegNach } from "@/lib/honorar-io";
import { statusFuer } from "@/lib/honorar-korrektur";
import { erfolg, fehler } from "@/lib/api";

/**
 * Sendet den Beleg eines genehmigten Honorarsatzes erneut an das DMS, wenn er
 * dort nicht angekommen ist (M12) — mit derselben Beleg-Nr. Dasselbe Recht wie
 * die Genehmigung; der Satz-Beleg enthält keine Bankverbindung.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_SATZ_GENEHMIGEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;

  let ergebnis;
  try {
    ergebnis = await sendeSatzBelegNach(id, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR] Nachversand fehlgeschlagen", f);
    return fehler("Der Beleg konnte nicht gesendet werden. Bitte versuchen Sie es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, statusFuer(ergebnis.code));
  return erfolg({ belegNr: ergebnis.belegNr, dmsGesendet: true });
}

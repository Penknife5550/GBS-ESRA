import { NextRequest } from "next/server";
import { pruefeZugriff, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { gibAbrechnungFrei } from "@/lib/honorar-abrechnung-io";
import { statusFuer } from "@/lib/honorar-korrektur";
import { erfolg, fehler } from "@/lib/api";

/**
 * Gibt eine Abrechnung zur Auszahlung frei — dabei geht der Zahlungsbeleg mit
 * IBAN an das DMS. Deshalb ist neben HONORAR_ABRECHNEN zusätzlich das
 * IBAN-Recht BANKVERBINDUNG_LESEN nötig (Datenminimierung, Art. 5 DSGVO).
 * Fachliches Nein: 404 (gibt es nicht/storniert), 409 (nicht mehr OFFEN, keine
 * IBAN hinterlegt), 500 (IBAN nicht entschlüsselbar — Betriebsfehler).
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_ABRECHNEN);
  if (benutzer instanceof Response) return benutzer;
  if (!hatRecht(benutzer, RECHT.BANKVERBINDUNG_LESEN)) {
    return fehler("Für die Freigabe wird zusätzlich das Recht zum Sehen der Bankverbindung benötigt, weil der Beleg die IBAN enthält.", 403);
  }

  const { id } = await kontext.params;

  let ergebnis;
  try {
    ergebnis = await gibAbrechnungFrei(id, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Freigabe fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht freigegeben werden. Bitte versuchen Sie es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, statusFuer(ergebnis.code));
  return erfolg({ belegNr: ergebnis.belegNr, dmsGesendet: ergebnis.dmsGesendet, dmsVersand: ergebnis.dmsVersand });
}

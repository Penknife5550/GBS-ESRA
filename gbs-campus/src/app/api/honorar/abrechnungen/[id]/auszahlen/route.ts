import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { markiereAusgezahlt } from "@/lib/honorar-abrechnung-io";
import { statusFuer } from "@/lib/honorar-korrektur";
import { alsTagesdatum } from "@/lib/semester";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({
  ausgezahltAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein Datum angeben."),
});

/**
 * Markiert eine freigegebene Abrechnung als ausgezahlt (mit Datum). Fachliches
 * Nein: 404 (gibt es nicht), 409 (nicht FREIGEGEBEN).
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_ABRECHNEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler(geprueft.error?.issues[0]?.message ?? "Ungültige Anfrage.", 400);
  }

  // Geprüfter Kalendertag-Parser (Round-Trip): `new Date("2026-02-30")` wirft
  // nicht, sondern rollt still auf den 02.03.
  const ausgezahltAm = alsTagesdatum(geprueft.data.ausgezahltAm);
  if (!ausgezahltAm) return fehler("Das Auszahlungsdatum ist ungültig.", 400);

  const { id } = await kontext.params;

  let ergebnis;
  try {
    ergebnis = await markiereAusgezahlt(id, ausgezahltAm, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Auszahlen fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht als ausgezahlt markiert werden. Bitte versuchen Sie es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, statusFuer(ergebnis.code));
  return erfolg({ ausgezahlt: true });
}

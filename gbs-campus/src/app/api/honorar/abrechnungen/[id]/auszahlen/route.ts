import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { markiereAusgezahlt } from "@/lib/honorar-abrechnung-io";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";

const schema = z.object({
  ausgezahltAm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein Datum angeben."),
});

/** Markiert eine freigegebene Abrechnung als ausgezahlt (mit Datum). */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.HONORAR_ABRECHNEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler(geprueft.error?.issues[0]?.message ?? "Ungültige Anfrage.", 400);
  }

  const ausgezahltAm = new Date(geprueft.data.ausgezahltAm);
  if (Number.isNaN(ausgezahltAm.getTime()) || ausgezahltAm.toISOString().slice(0, 10) !== geprueft.data.ausgezahltAm) {
    return fehler("Das Auszahlungsdatum ist ungültig.", 400);
  }

  const { id } = await kontext.params;

  let ergebnis;
  try {
    ergebnis = await markiereAusgezahlt(id, ausgezahltAm, benutzer.id, request.headers);
  } catch (f) {
    console.error("[HONORAR-ABRECHNUNG] Auszahlen fehlgeschlagen", f);
    return fehler("Die Abrechnung konnte nicht als ausgezahlt markiert werden. Bitte versuche es später noch einmal.", 500);
  }

  if (!ergebnis.ok) return fehler(ergebnis.meldung, 400);
  return erfolg({ ausgezahlt: true });
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { genehmigeHonorarSatz } from "@/lib/honorar-io";
import { HONORAR_SATZ_MIN, HONORAR_SATZ_MAX } from "@/lib/honorar";
import { alsTagesdatum } from "@/lib/semester";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({
  betrag: z
    .number({ message: "Bitte einen Betrag in Euro angeben." })
    .int("Der Satz muss eine ganze Zahl in Euro sein.")
    .min(HONORAR_SATZ_MIN, `Der Satz muss zwischen ${HONORAR_SATZ_MIN} und ${HONORAR_SATZ_MAX} € liegen.`)
    .max(HONORAR_SATZ_MAX, `Der Satz muss zwischen ${HONORAR_SATZ_MIN} und ${HONORAR_SATZ_MAX} € liegen.`),
  // Reines Kalenderdatum (Tagesgenauigkeit reicht für einen Gültig-ab-Satz).
  gueltigAb: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein Datum angeben."),
  notiz: z.string().max(500, "Der Vermerk ist zu lang.").optional(),
});

/**
 * Genehmigt einen neuen Honorarsatz. Das Eintragen durch eine berechtigte Person
 * IST die Genehmigung; die eigentliche Fachlogik (Historien-Zeile, DMS-Beleg)
 * liegt in `genehmigeHonorarSatz`, damit sie ohne HTTP testbar bleibt.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.HONORAR_SATZ_GENEHMIGEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler(geprueft.error?.issues[0]?.message ?? "Ungültige Anfrage.", 400);
  }

  // Geprüfter Kalendertag-Parser mit Round-Trip: `new Date("2026-02-30")` wirft
  // nicht, sondern rollt still auf den 02.03. — ein reiner getTime-Check würde
  // das durchlassen und einen Satz mit falschem Gültig-ab lohnwirksam anlegen.
  const gueltigAb = alsTagesdatum(geprueft.data.gueltigAb);
  if (!gueltigAb) return fehler("Das Gültig-ab-Datum ist ungültig.", 400);

  // Bei einer finanzwirksamen Genehmigung nicht auf den generischen 500 des
  // Frameworks verlassen: ein DB-Ausfall im create soll eine deutsche Meldung
  // liefern, kein Leak. Der DMS-/Mailpfad ist in genehmigeHonorarSatz selbst
  // gefangen und wirft nicht.
  let ergebnis;
  try {
    ergebnis = await genehmigeHonorarSatz({
      betrag: geprueft.data.betrag,
      gueltigAb,
      notiz: geprueft.data.notiz ?? null,
      akteurId: benutzer.id,
      headers: request.headers,
    });
  } catch (f) {
    console.error("[HONORAR] Genehmigung fehlgeschlagen", f);
    return fehler("Der Satz konnte nicht genehmigt werden. Bitte versuchen Sie es später noch einmal.", 500);
  }

  if (!ergebnis.ok) {
    return fehler(ergebnis.meldung, 400);
  }

  return erfolg({ belegNr: ergebnis.belegNr, dmsGesendet: ergebnis.dmsGesendet, dmsVersand: ergebnis.dmsVersand });
}

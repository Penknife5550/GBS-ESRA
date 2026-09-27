import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { trageZusageEin } from "@/lib/ueberleitung";

const schema = z.object({ teilnahmeId: z.string().uuid() });

/**
 * Trägt für eine offene Einladung die Zusage von Hand ein (Recht
 * SEMESTER_VERWALTEN: Schulleitung und Verwaltung) — etwa nach einem Anruf. Vorher fiel wer telefonisch
 * zusagte, am Starttag als „keine Rückmeldung" heraus.
 *
 * Die Arbeit liegt in `trageZusageEin` (bedingtes updateMany auf die offene
 * Einladung, Audit TEILNAHME_ZUSAGE_EINGETRAGEN); diese Route ist Wachposten +
 * Statuscode-Abbildung. Ein Doppelklick ergibt einen Eintrag und ein 409.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await trageZusageEin(geprueft.data.teilnahmeId, benutzer.id, request.headers);

  switch (ergebnis.status) {
    case "ok":
      return erfolg({ bestaetigt: true });
    case "unbekannt":
      return fehler("Diese Teilnahme gibt es nicht.", 404);
    case "abgemeldet":
      return fehler(
        "Diese Teilnahme ist abgemeldet — eine Zusage lässt sich hier nicht mehr eintragen. Bitte nehmen Sie die Person über „Wieder aufnehmen“ zurück.",
        409,
      );
    case "bestaetigt":
      return fehler("Diese Teilnahme ist bereits bestätigt.", 409);
    case "ohne_einladung":
      return fehler("Zu dieser Teilnahme gibt es keine offene Einladung — sie zählt bereits.", 409);
    case "nicht_aktiv":
      return fehler(
        `Diese Person ist nicht aktiv (Status „${ergebnis.statusBezeichnung}“). Bitte zuerst den Status klären.`,
        409,
      );
    case "gerade_geaendert":
      return fehler("Die Rückmeldung zu dieser Teilnahme hat sich gerade geändert. Bitte laden Sie die Seite neu.", 409);
    default:
      return nieErreicht(ergebnis);
  }
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { loeseMagicLinkEin } from "@/lib/magic-link";
import { sitzungAnlegen } from "@/lib/session";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";

const schema = z.object({ token: z.string().uuid() });

/**
 * Löst einen Anmeldelink ein. Bewusst POST — siehe Kommentar in
 * src/app/anmelden/token/page.tsx (Link-Scanner und Login-CSRF).
 *
 * Reihenfolge: erst entwerten, dann die Sitzung anlegen. Bis Code-Review 4
 * behauptete dieser Kommentar das Gegenteil; der Code tat aber schon immer dies,
 * und das ist die sichere Richtung: Das bedingte Entwerten in
 * `loeseMagicLinkEin` stellt sicher, dass zwei gleichzeitige Aufrufe nicht
 * beide eine Sitzung bekommen. Umgekehrt hinge die Einmaligkeit des Links
 * daran, dass nach dem Anlegen der Sitzung nichts mehr schiefgeht.
 *
 * Der Preis: Scheitert `sitzungAnlegen` (praktisch nur bei fehlendem
 * SESSION_SECRET, das der Startprüfer schon abfängt), ist der Link verbraucht.
 * Er wird bewusst nicht wieder freigegeben — ein zurückgesetztes `benutztAm`
 * könnte einen Link wiederbeleben, den eine Adressänderung durch die Verwaltung
 * gerade entwertet hat. Stattdessen sagt die Antwort klar, dass ein neuer Link
 * nötig ist.
 */
export async function POST(request: NextRequest) {
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Dieser Link ist ungültig. Bitte fordere einen neuen an.", 400);
  }

  const personId = await loeseMagicLinkEin(geprueft.data.token);

  if (!personId) {
    await protokolliere({
      aktion: "ANMELDUNG_FEHLGESCHLAGEN",
      objektTyp: "MagicLink",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler("Dieser Link ist abgelaufen oder wurde bereits benutzt.", 401);
  }

  try {
    await sitzungAnlegen(personId);
  } catch (f) {
    console.error("[ANMELDUNG] Sitzung konnte nach dem Einlösen nicht angelegt werden:", f);
    return fehler(
      "Die Anmeldung hat nicht geklappt, und dieser Link ist dabei verbraucht worden. " +
        "Bitte fordere einen neuen an.",
      500,
    );
  }

  await protokolliere({
    aktion: "ANGEMELDET",
    objektTyp: "Person",
    objektId: personId,
    akteurId: personId,
    headers: request.headers,
  });

  return erfolg({ angemeldet: true });
}

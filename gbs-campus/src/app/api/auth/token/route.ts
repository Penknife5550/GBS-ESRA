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
 * Reihenfolge: erst die Sitzung anlegen, dann entwerten. Umgekehrt wäre der Link
 * bei einem Fehler in `sitzungAnlegen` unwiederbringlich verbrannt, und jeder
 * neu angeforderte Link würde genauso verbrennen.
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

  await sitzungAnlegen(personId);

  await protokolliere({
    aktion: "ANGEMELDET",
    objektTyp: "Person",
    objektId: personId,
    akteurId: personId,
    headers: request.headers,
  });

  return erfolg({ angemeldet: true });
}

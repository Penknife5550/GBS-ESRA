import { NextRequest } from "next/server";
import { z } from "zod";
import { fordereMagicLinkAn } from "@/lib/magic-link";
import { ermittleRequestKontext } from "@/lib/request-kontext";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";

/**
 * 254 Zeichen ist die längste Adresse, die RFC 5321 zulässt. Die Grenze ist
 * nicht Kosmetik: Ohne sie ginge die vollständige Eingabe in den
 * Drosselschlüssel `MAGIC_LINK:<adresse>` ein, und ab etwa 2700 Byte sprengt
 * ein Schlüssel den Btree-Index auf `rate_limit` — die Anfrage endete mit einem
 * Serverfehler statt mit einer Abweisung, und die Drossel würde nichts mehr
 * mitschreiben.
 */
const schema = z.object({ email: z.string().max(254).email() });

export async function POST(request: NextRequest) {
  const rumpf = await request.json().catch(() => null);
  const geprueft = schema.safeParse(rumpf);

  if (!geprueft.success) {
    return fehler("Bitte eine gültige E-Mail-Adresse angeben.", 400);
  }

  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);
  const { gedrosselt } = await fordereMagicLinkAn(geprueft.data.email, ipAdresse, userAgent);

  if (gedrosselt) {
    // Bewusst ohne `nachher`: Diesen Zweig kann ein Angreifer beliebig oft
    // auslösen, und das Audit-Log ist per Datenbank-Trigger auch für den
    // Administrator unlöschbar. Stünde die eingegebene Adresse darin, ließe
    // sich die Tabelle mit fremdem Text vollschreiben, den niemand mehr
    // entfernen kann. Dass gedrosselt wurde, ist mit Zeitpunkt, IP und
    // User-Agent hinreichend belegt.
    await protokolliere({
      aktion: "ANMELDUNG_GEDROSSELT",
      objektTyp: "MagicLink",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler("Zu viele Anfragen. Bitte später erneut versuchen.", 429);
  }

  // Immer dieselbe Antwort, unabhängig davon, ob die Adresse bekannt ist —
  // sonst wäre dieser Endpunkt ein Verzeichnis aller Teilnehmer.
  return erfolg({
    hinweis: "Wenn die Adresse bei uns hinterlegt ist, ist eine E-Mail mit dem Anmeldelink unterwegs.",
  });
}

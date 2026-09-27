import { NextRequest } from "next/server";
import { z } from "zod";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { benachrichtigeVerwaltungUeberAenderung, loeseEmailAenderungEin } from "@/lib/selbstpflege";

const schema = z.object({ token: z.string().uuid() });

/**
 * Löst den Bestätigungslink für eine neue E-Mail-Adresse ein.
 *
 * Bewusst POST von einer Bestätigungsseite aus — aus demselben Grund wie beim
 * Anmeldelink: Link-Scanner in Mail-Sicherheitslösungen würden einen GET-Link
 * abrufen und den Token verbrauchen, bevor der Empfänger überhaupt klickt.
 *
 * Bewusst OHNE Anmeldung: Der Link wird im neuen Postfach geöffnet, oft auf
 * einem anderen Gerät. Sicherheit bringt hier nicht die Sitzung — wer eine
 * fremde Sitzung hat, hat den Antrag ohnehin selbst gestellt —, sondern der
 * Hinweis an die bisherige Adresse.
 */
export async function POST(request: NextRequest) {
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Dieser Bestätigungslink ist ungültig.", 400);
  }

  const ergebnis = await loeseEmailAenderungEin(geprueft.data.token);

  if (!ergebnis.ok) {
    await protokolliere({
      aktion: "EMAIL_AENDERUNG_FEHLGESCHLAGEN",
      objektTyp: "EmailAenderung",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler(ergebnis.meldung, ergebnis.status);
  }

  // Ab hier ist die neue Adresse gesetzt und die Änderung committet. Was jetzt
  // noch scheitert — Protokoll oder Mail an die Verwaltung —, darf den
  // Bestätigenden nicht mit einem 500 behelligen: Er hielte seine Adresse für
  // ungeändert, obwohl sein Zugang bereits über die neue läuft, und würde es im
  // schlimmsten Fall erneut versuchen. Also laut loggen, Erfolg melden.
  try {
    await protokolliere({
      aktion: "EMAIL_AENDERUNG_BESTAETIGT",
      objektTyp: "Person",
      objektId: ergebnis.person.id,
      akteurId: ergebnis.person.id,
      // Ohne die Adressen (Code-Review 4, M6c) — siehe EMAIL_AENDERUNG_BEANTRAGT.
      // Die Zahl der entwerteten Auskunfts- und Anmeldelinks (sie lagen im
      // bisherigen Postfach).
      nachher: {
        geaenderteFelder: ["email"],
        entwerteteAuskunftslinks: ergebnis.entwerteteAuskunftslinks,
        entwerteteAnmeldelinks: ergebnis.entwerteteAnmeldelinks,
      },
      headers: request.headers,
    });

    await benachrichtigeVerwaltungUeberAenderung(
      { ...ergebnis.person, email: ergebnis.neueEmail },
      ["E-Mail-Adresse"],
    );
  } catch (ausnahme) {
    console.error(
      "[MEINE-DATEN] Nachbereitung der bestätigten E-Mail-Änderung fehlgeschlagen:",
      ergebnis.person.id,
      ausnahme,
    );
  }

  return erfolg({ bestaetigt: true, email: ergebnis.neueEmail });
}

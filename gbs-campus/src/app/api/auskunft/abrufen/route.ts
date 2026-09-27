import { NextRequest } from "next/server";
import { z } from "zod";
import { ruftAuskunftAb } from "@/lib/auskunft";
import { protokolliere } from "@/lib/audit";
import { fehler } from "@/lib/api";

const schema = z.object({ token: z.string().uuid() });

/**
 * Löst einen Auskunfts-Link ein und streamt die PDF.
 *
 * Die eigentliche Entscheidung (Token gültig? Person verstorben/gelöscht? PDF)
 * liegt in `ruftAuskunftAb` — ohne HTTP testbar. Diese Route bildet das Ergebnis
 * nur auf Statuscode + Audit + Antwort ab.
 *
 * Bewusst POST von einer Bestätigungsseite aus — wie beim Anmeldelink: Link-
 * Scanner in Mail-Sicherheitslösungen rufen Links vorab ab; die volle Datenkopie
 * soll erst auf ausdrücklichen Klick der Person entstehen.
 */
export async function POST(request: NextRequest) {
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Dieser Link ist ungültig. Bitte fordern Sie die Auskunft erneut an.", 400);
  }

  let ergebnis;
  try {
    ergebnis = await ruftAuskunftAb(geprueft.data.token);
  } catch (ausnahme) {
    // Ein gültiger Art.-15-Abruf, der server-seitig scheitert (DB, PDF-Erzeugung),
    // hat eine gesetzliche Frist — er darf nicht stumm im 500 verschwinden.
    // Sichtbar machen wie der Token-Fehlerpfad. Kein Geheimnis in die Meldung.
    console.error("[AUSKUNFT] Abruf server-seitig fehlgeschlagen:", ausnahme);
    await protokolliere({
      aktion: "AUSKUNFT_ABRUF_FEHLGESCHLAGEN",
      objektTyp: "Datenauskunft",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler("Beim Erstellen der Auskunft ist ein Fehler aufgetreten. Bitte versuchen Sie es später noch einmal.", 500);
  }

  if (ergebnis.status === "ungueltig") {
    await protokolliere({
      aktion: "AUSKUNFT_ABRUF_FEHLGESCHLAGEN",
      objektTyp: "Datenauskunft",
      quelle: "SYSTEM",
      headers: request.headers,
    });
    return fehler("Dieser Link ist abgelaufen oder ungültig. Bitte fordern Sie die Auskunft erneut an.", 401);
  }
  if (ergebnis.status === "weg") {
    return fehler("Die zugehörige Person ist nicht mehr vorhanden.", 404);
  }
  if (ergebnis.status === "verstorben") {
    // Das Auskunftsrecht endet mit dem Tod — auch für einen vor dem Tod
    // ausgestellten, noch gültigen Token.
    return fehler("Diese Auskunft ist nicht mehr abrufbar.", 410);
  }

  await protokolliere({
    aktion: "AUSKUNFT_ABGERUFEN",
    objektTyp: "Person",
    objektId: ergebnis.personId,
    akteurId: ergebnis.personId,
    quelle: "WEB",
    headers: request.headers,
  });

  return new Response(new Uint8Array(ergebnis.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Datenauskunft-GBS-Campus.pdf"',
      // Nie zwischenspeichern — die Auskunft enthält besondere Kategorien.
      "Cache-Control": "no-store",
    },
  });
}

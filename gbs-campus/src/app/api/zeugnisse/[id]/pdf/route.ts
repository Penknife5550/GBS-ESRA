import { NextRequest } from "next/server";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { downloadFehler } from "@/lib/api";
import { SITZUNG_ABGELAUFEN } from "@/lib/api-client";
import { RECHT } from "@/lib/constants";
import { erzeugeZeugnisPdf, ladeZeugnisFuerDownload } from "@/lib/zeugnis-io";

/**
 * Liefert EIN Zeugnis als PDF (Einzeldruck der Schulleitung bzw. Download durch
 * den Schüler selbst). Zugriff: das eigene Zeugnis (PERSON_LESEN_EIGENE, streng
 * auf die eigene personId) ODER NOTEN_VERWALTEN (Schulleitung, alle). Die
 * Zugriffsprüfung läuft VOR der PDF-Erzeugung.
 *
 * Ein durch Neuausstellung ERSETZTES Zeugnis ist kein gültiges Dokument mehr: Der
 * Schüler kennt seine Id noch von vor der Korrektur und bekäme sonst ein gültig
 * aussehendes PDF — für ihn 410. Die Schulleitung (Nachweis) bekommt es mit dem
 * Kopfvermerk „UNGÜLTIG – ersetzt durch … am …“.
 *
 * Fehler gehen über `downloadFehler`: Der Link wird im Browser geöffnet, dort
 * gibt es statt rohem JSON eine Fehlerseite bzw. bei abgelaufener Sitzung die
 * Anmeldung.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) return downloadFehler(request, SITZUNG_ABGELAUFEN, 401);

  const { id } = await params;

  try {
    const dokument = await ladeZeugnisFuerDownload(id);
    if (!dokument) return downloadFehler(request, "Dieses Zeugnis gibt es nicht.", 404);

    const eigenes = dokument.personId === benutzer.id && hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE);
    const darfAlle = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
    if (!eigenes && !darfAlle) return downloadFehler(request, "Keine Berechtigung.", 403);

    const gueltig = dokument.status === "GUELTIG";
    if (!gueltig && !darfAlle) {
      return downloadFehler(
        request,
        "Dieses Zeugnis wurde durch eine neue Ausfertigung ersetzt und ist nicht mehr gültig. Die gültige Ausfertigung steht unter „Meine Daten“.",
        410,
      );
    }

    const pdf = erzeugeZeugnisPdf(dokument);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dokument.belegNr}${gueltig ? "" : "-UNGUELTIG"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (ausnahme) {
    console.error("[ZEUGNIS] Einzeldruck fehlgeschlagen für", id, ausnahme);
    return downloadFehler(request, "Das PDF konnte nicht erzeugt werden. Bitte versuchen Sie es später erneut.", 500);
  }
}

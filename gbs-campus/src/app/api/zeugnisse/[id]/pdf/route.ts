import { NextRequest } from "next/server";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { fehler, keineBerechtigung, nichtAngemeldet } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { erzeugeZeugnisPdfAusSnapshot, ladeZeugnisFuerDownload } from "@/lib/zeugnis-io";

/**
 * Liefert EIN Zeugnis als PDF (Einzeldruck der Schulleitung bzw. Download durch
 * den Schüler selbst). Zugriff: das eigene Zeugnis (PERSON_LESEN_EIGENE, streng
 * auf die eigene personId) ODER NOTEN_VERWALTEN (Schulleitung, alle). Die
 * Zugriffsprüfung läuft VOR der PDF-Erzeugung.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) return nichtAngemeldet();

  const { id } = await params;

  try {
    const dokument = await ladeZeugnisFuerDownload(id);
    if (!dokument) return fehler("Dieses Zeugnis gibt es nicht.", 404);

    const eigenes = dokument.personId === benutzer.id && hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE);
    const darfAlle = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
    if (!eigenes && !darfAlle) return keineBerechtigung();

    const pdf = erzeugeZeugnisPdfAusSnapshot(dokument.snapshot);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dokument.belegNr}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (ausnahme) {
    console.error("[ZEUGNIS] Einzeldruck fehlgeschlagen für", id, ausnahme);
    return fehler("Das PDF konnte nicht erzeugt werden. Bitte versuche es später erneut.", 500);
  }
}

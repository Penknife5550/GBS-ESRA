import { NextRequest } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { alsDownloadFehler, downloadFehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { GEWAEHLTE_TYPEN } from "@/lib/zeugnis";
import { erzeugeSeriendruckPdf } from "@/lib/zeugnis-io";

const schema = z.object({ semester: z.string().uuid(), typ: z.enum(GEWAEHLTE_TYPEN) });

/**
 * Liefert das kombinierte Druck-PDF aller gültigen Zeugnisse eines Semesters
 * (gewählter Typ + Hörer-Bescheinigungen) — je Person auf eigenem Blatt, aus den
 * eingefrorenen Snapshots. Schulleitung (Recht NOTEN_VERWALTEN).
 *
 * Fehler gehen über `downloadFehler` (Fehlerseite statt rohem JSON im Browser).
 */
export async function GET(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.NOTEN_VERWALTEN);
  if (benutzer instanceof Response) return alsDownloadFehler(request, benutzer);

  const { searchParams } = new URL(request.url);
  const geprueft = schema.safeParse({ semester: searchParams.get("semester"), typ: searchParams.get("typ") });
  if (!geprueft.success) return downloadFehler(request, "Ungültige Anfrage.", 400);

  try {
    const ergebnis = await erzeugeSeriendruckPdf(geprueft.data.semester, geprueft.data.typ);
    if ("leer" in ergebnis) {
      return downloadFehler(request, "Für dieses Semester sind noch keine Zeugnisse ausgestellt.", 404);
    }

    return new Response(new Uint8Array(ergebnis.pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Zeugnisse-Seriendruck.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (ausnahme) {
    console.error("[ZEUGNIS] Seriendruck fehlgeschlagen", ausnahme);
    return downloadFehler(request, "Der Seriendruck konnte nicht erzeugt werden. Bitte versuchen Sie es später erneut.", 500);
  }
}

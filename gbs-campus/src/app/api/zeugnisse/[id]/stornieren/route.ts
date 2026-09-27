import { NextRequest, after } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, mitFehlerbehandlung, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeStornoGrund, STORNO_GRUND_MAX_LAENGE } from "@/lib/zeugnis";
import { sendeStornoVermerkAnDms, storniereZeugnis } from "@/lib/zeugnis-io";

// Den Grund prüft `pruefeStornoGrund` mit deutscher Meldung (Pflicht, getrimmt
// nicht leer, höchstens 500 Zeichen); hier nur eine grobe Obergrenze gegen
// übergroße Rümpfe.
const schema = z.object({ grund: z.string().max(STORNO_GRUND_MAX_LAENGE * 4).nullish() });

/**
 * Storniert ein gültiges Zeugnis ohne Ersatz (Schulleitung, Recht
 * NOTEN_VERWALTEN) — für Fehlausstellungen: falsches Semester, falscher Typ,
 * Person gar nicht teilnahmeberechtigt. Das Zeugnis wird ungültig, ist für die
 * Person nicht mehr abrufbar (PDF-Route 410) und bleibt mit Zeitpunkt, Akteur
 * und Grund als Nachweis gespeichert. Der Sammellauf stellt es danach nicht still
 * neu aus; die Einzel-Ausstellung bleibt möglich.
 *
 * 400 ohne Grund, 404 unbekannt, 409 nicht (mehr) gültig oder Person
 * anonymisiert. Audit ZEUGNIS_STORNIERT ohne den Grundtext. Ist ein DMS
 * eingerichtet, geht NACH der Antwort ein kurzer Storno-Vermerk dorthin (best
 * effort, ohne Namen und ohne Grund).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.NOTEN_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);
  const grund = pruefeStornoGrund(geprueft.data.grund);
  if (!grund.ok) return fehler(grund.meldung, 400);

  const { id } = await params;

  return mitFehlerbehandlung("ZEUGNIS", "Das Zeugnis konnte nicht storniert werden.", async () => {
    const ergebnis = await storniereZeugnis(id, grund.grund, benutzer.id, request.headers);
    if ("fehler" in ergebnis) {
      // Anonymisiert: kein Storno mehr — die Begründung kommt fertig aus
      // `stornoSperreFuerPerson`.
      if (ergebnis.fehler === "person_gesperrt") return fehler(ergebnis.meldung, 409);
      switch (ergebnis.fehler) {
        case "fehlt":
          return fehler("Dieses Zeugnis gibt es nicht.", 404);
        case "nicht_gueltig":
          return fehler(
            "Dieses Zeugnis ist nicht (mehr) gültig — es wurde bereits ersetzt oder storniert. Bitte laden Sie die Seite neu.",
            409,
          );
        default:
          return nieErreicht(ergebnis);
      }
    }

    const { belegNr, titel, abschnitt, storniertAm } = ergebnis;
    after(() => sendeStornoVermerkAnDms({ belegNr, titel, abschnitt, storniertAm }));
    return erfolg({ zeugnisId: ergebnis.zeugnisId, belegNr, status: "STORNIERT", storniertAm: storniertAm.toISOString() });
  });
}

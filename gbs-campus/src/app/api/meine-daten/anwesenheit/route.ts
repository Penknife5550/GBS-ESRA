import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { bestaetigeEigeneAnwesenheit } from "@/lib/stundenplan-io";

// Nur die zwei positiven Zustände: „entschuldigt" entscheidet die Schule,
// „gefehlt" bestätigt niemand über sich selbst. Ein anderer Wert wird schon hier
// mit 400 abgewiesen und erreicht die Fachlogik gar nicht.
const schema = z.object({
  terminId: z.string().uuid(),
  status: z.enum(["ANWESEND", "NACHGEARBEITET"]),
});

/**
 * Selbstbestätigung der eigenen Anwesenheit an einem vergangenen
 * Unterrichtsabend. Der Teilnehmer setzt ausschließlich seinen eigenen Eintrag;
 * die drei Regeln (erlaubter Status, Abend liegt zurück, kein von der Verwaltung
 * erfasster Eintrag) prüft `bestaetigeEigeneAnwesenheit`.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_BEARBEITEN_EIGENE);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await bestaetigeEigeneAnwesenheit(
    benutzer.id,
    geprueft.data.terminId,
    geprueft.data.status,
    request.headers,
  );

  if ("fehler" in ergebnis) {
    switch (ergebnis.fehler) {
      case "status_ungueltig":
        return fehler("Für dich sind nur anwesend und nachgearbeitet möglich.", 400);
      case "termin_fehlt":
        return fehler("Diesen Unterrichtsabend gibt es nicht.", 404);
      case "nicht_eingeschrieben":
        return fehler("Dieser Abend gehört nicht zu einem deiner Semester.", 404);
      case "zukunft":
        return fehler("Dieser Abend hat noch nicht stattgefunden.", 409);
      case "fremd_erfasst":
        return fehler("Für diesen Abend hat die Schule die Anwesenheit bereits erfasst.", 409);
    }
  }

  return erfolg(ergebnis);
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { ladeMitRecht } from "@/lib/berechtigung";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { starteUeberleitung } from "@/lib/ueberleitung";

const schema = z.object({ semesterId: z.string().uuid() });

/**
 * Stößt die Semesterüberleitung ins gewählte Folgesemester an: legt für jeden
 * aktiven Teilnehmer des laufenden Semesters eine noch unbestätigte Teilnahme
 * mit persönlichem „bin dabei"-Link an und verschickt die Einladung.
 *
 * Die eigentliche Arbeit liegt in `starteUeberleitung` (ohne HTTP testbar);
 * diese Route ist Wachposten + Statuscode-Abbildung.
 */
export async function POST(request: NextRequest) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await starteUeberleitung(geprueft.data.semesterId, benutzer.id, request.headers);

  if (ergebnis.status === "ziel_fehlt") return fehler("Dieses Semester gibt es nicht.", 404);
  if (ergebnis.status === "kein_laufendes") {
    return fehler("Es ist kein laufendes Semester festgelegt. Bitte zuerst das aktuelle Semester setzen.", 409);
  }
  if (ergebnis.status === "ziel_ist_laufendes") {
    return fehler("Das gewählte Semester ist bereits das laufende. Bitte ein Folgesemester wählen.", 409);
  }

  return erfolg({ eingeladen: ergebnis.eingeladen, gesendet: ergebnis.gesendet });
}

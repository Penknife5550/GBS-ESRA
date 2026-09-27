import { NextRequest, after } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { starteUeberleitung, versendeEinladungen } from "@/lib/ueberleitung";

const schema = z.object({ semesterId: z.string().uuid() });

/**
 * Stößt die Semesterüberleitung ins gewählte Folgesemester an: legt für jeden
 * Teilnehmer des laufenden Semesters eine noch unbeantwortete Teilnahme mit
 * persönlichem „bin dabei / bin raus"-Link an und antwortet sofort mit der Zahl
 * der Eingeladenen.
 *
 * Der Mailversand läuft danach (`after`), höchstens drei gleichzeitig. Vorher
 * wartete die Route seriell auf jede einzelne Mail — bei 150 Empfängern oder
 * hakendem SMTP länger als die 30-s-Zeitgrenze des Clients: Die Schulleitung sah
 * „zu lange nicht geantwortet", und ein zweiter Klick meldete „niemand neu
 * einzuladen". Warum `after` statt des Workers: Den Klartext-Token kennt nur
 * dieser Prozess (in der Datenbank steht nur der Hash); der Worker müsste für
 * denselben Versand erst neue Links erzeugen. Bricht der Prozess mitten im
 * Versand ab, steht der Start trotzdem im Audit und jede Mail einzeln in der
 * Betriebsansicht. Einen frischen Link bringt die nächste Erinnerung nur, wenn
 * noch ein Stichtag aussteht — ab dem letzten Stichtag (T-3) nicht mehr; darauf
 * weist die Überleitungsseite beim Start hin (siehe `versendeEinladungen`).
 *
 * Die eigentliche Arbeit liegt in `starteUeberleitung` (ohne HTTP testbar);
 * diese Route ist Wachposten + Statuscode-Abbildung.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

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
  if (ergebnis.status === "ziel_begonnen") {
    return fehler(
      "Das gewählte Semester hat bereits begonnen. Eingeladen werden kann nur in ein Semester, das noch bevorsteht.",
      409,
    );
  }

  if (ergebnis.einladungen.length > 0) {
    const { ziel, einladungen } = ergebnis;
    after(() => versendeEinladungen(ziel, einladungen, benutzer.id));
  }

  return erfolg({ eingeladen: ergebnis.eingeladen });
}

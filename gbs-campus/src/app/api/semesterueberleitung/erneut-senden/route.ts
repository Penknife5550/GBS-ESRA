import { NextRequest, after } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { bereiteNachversandVor } from "@/lib/ueberleitung";

const schema = z.object({ semesterId: z.string().uuid() });

/**
 * „Erneut senden" auf der Überleitungsseite: Jede offene Einladung des Semesters,
 * die nie zugestellt wurde (keine GESENDET-Zeile für Einladung oder Erinnerung
 * seit der Einladung), bekommt einen frischen Link und die Einladung noch
 * einmal. Nur vor Semesterstart, nur auf Knopfdruck — der Worker sendet nichts
 * von selbst nach.
 *
 * Wie beim Start: Die Route antwortet sofort mit der Zahl, die Mails gehen
 * danach raus (`after`), höchstens drei gleichzeitig. Den Klartext der neuen
 * Links kennt nur dieser Prozess (in der Datenbank steht nur der Hash). Die
 * Arbeit liegt in `bereiteNachversandVor`; diese Route ist Wachposten +
 * Statuscode-Abbildung.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const ergebnis = await bereiteNachversandVor(geprueft.data.semesterId, benutzer.id, request.headers);

  if (ergebnis.status === "ziel_fehlt") return fehler("Dieses Semester gibt es nicht.", 404);
  if (ergebnis.status === "ziel_begonnen") {
    return fehler(
      "Das Semester hat bereits begonnen. Einladungen lassen sich nur bis zum Tag vor Semesterbeginn erneut senden — wer nicht geantwortet hat, wird zum Start abgemeldet und lässt sich einzeln wieder aufnehmen.",
      409,
    );
  }
  if (ergebnis.status === "versand_laeuft") {
    return fehler(
      "Für dieses Semester werden gerade Einladungen verschickt. Bitte laden Sie die Seite in einer Minute neu — dann sehen Sie, ob noch Einladungen fehlen.",
      409,
    );
  }

  // Ohne diesen Aufruf bliebe das Semester bis zum Neustart „im Versand“ —
  // `bereiteNachversandVor` gibt es erst am Ende des Versands wieder frei.
  if (ergebnis.versand) after(ergebnis.versand);

  return erfolg({ erneutEingeladen: ergebnis.anzahl });
}

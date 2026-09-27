import { NextRequest, after } from "next/server";
import { z } from "zod";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler, mitFehlerbehandlung, nieErreicht } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { GEWAEHLTE_TYPEN } from "@/lib/zeugnis";
import { archiviereNeueImDms, stelleSemesterZeugnisseAus, stelleZeugnisAus } from "@/lib/zeugnis-io";

// Mit personId = Einzel-Ausstellung/Neuausstellung (mit Storno des bestehenden),
// ohne = Sammellauf für alle aktiven Teilnehmer des Semesters (idempotent; für
// Abschlusszeugnisse nur im letzten Semester des Rasters).
const schema = z.object({
  semesterId: z.string().uuid(),
  typ: z.enum(GEWAEHLTE_TYPEN),
  personId: z.string().uuid().optional(),
});

/**
 * Stellt Zeugnisse aus (Schulleitung, Recht NOTEN_VERWALTEN) — einzeln oder als
 * Sammellauf je Semester. Die Ausstellung friert den aktuellen Notenstand als
 * Snapshot ein; eine Neuausstellung storniert das vorige Zeugnis.
 *
 * Die DMS-Archivkopie geht NACH der Antwort raus (`after`): Vorher wartete die
 * Route auf die Mail, und bei hakendem SMTP meldete die Oberfläche eine
 * Zeitüberschreitung, obwohl längst ausgestellt war. Ein ausgebliebener Versand
 * bleibt über `dmsGesendetAm` sichtbar und lässt sich auf der Zeugnisseite
 * nachsenden.
 *
 * Unerwartete Fehler (Datenbank weg, Deadlock) fängt `mitFehlerbehandlung` ab:
 * deutsche Meldung statt Framework-500, Log-Präfix [ZEUGNIS].
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.NOTEN_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);
  const { semesterId, typ, personId } = geprueft.data;

  return mitFehlerbehandlung("ZEUGNIS", "Das Zeugnis konnte nicht ausgestellt werden.", async () => {
    if (personId) {
      const ergebnis = await stelleZeugnisAus(personId, typ, semesterId, benutzer.id, request.headers);
      if ("fehler" in ergebnis) {
        // Anonymisiert oder Endzustand: keine (Neu-)Ausstellung mehr — die
        // Begründung kommt fertig aus `zeugnisSperreFuerPerson`.
        if (ergebnis.fehler === "person_gesperrt") return fehler(ergebnis.meldung, 409);
        switch (ergebnis.fehler) {
          case "person_fehlt":
            return fehler("Diese Person gibt es nicht.", 404);
          case "semester_fehlt":
            return fehler("Dieses Semester gibt es nicht.", 404);
          case "nicht_eingeschrieben":
            return fehler("Diese Person ist in diesem Semester nicht eingeschrieben.", 409);
          case "abgemeldet":
            return fehler("Diese Person ist für dieses Semester abgemeldet — dafür wird kein Zeugnis ausgestellt.", 409);
          case "gleichzeitig":
            return fehler("Es wurde zeitgleich schon ein Zeugnis ausgestellt. Bitte neu laden.", 409);
          default:
            return nieErreicht(ergebnis);
        }
      }
      const { zeugnisId, belegNr, snapshot } = ergebnis;
      after(() => archiviereNeueImDms([{ zeugnisId, belegNr, snapshot }]));
      return erfolg({ zeugnisId, belegNr, version: ergebnis.version });
    }

    const ergebnis = await stelleSemesterZeugnisseAus(semesterId, typ, benutzer.id, request.headers);
    if ("fehler" in ergebnis) {
      if (ergebnis.fehler === "semester_fehlt") return fehler("Dieses Semester gibt es nicht.", 404);
      // Abschlusszeugnisse gesammelt nur im letzten Semester des Rasters.
      return fehler(ergebnis.meldung, 400);
    }
    // Die neuen Zeugnisse (mit Snapshot) nur für die Archivkopie — in die Antwort
    // gehören allein die Zahlen.
    const { neu, ...zahlen } = ergebnis;
    if (neu.length > 0) after(() => archiviereNeueImDms(neu));
    return erfolg(zahlen);
  });
}

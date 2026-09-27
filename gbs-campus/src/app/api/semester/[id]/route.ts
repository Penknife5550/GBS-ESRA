import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeKuerzelUnveraendert, pruefeSemester, semesterDaten, semesterHatBegonnen } from "@/lib/semester";
import { zaehleOffeneEinladungen, ziehLinkfristNach } from "@/lib/ueberleitung";

const schema = z.object({
  code: z.string(),
  bezeichnung: z.string(),
  start: z.string(),
  ende: z.string(),
  anmeldungVon: z.string().nullish(),
  anmeldungBis: z.string().nullish(),
  // Fehlt der Schlüssel, bleibt die gespeicherte Rasterverortung stehen; null
  // leert sie. Bereich und „beide oder keins" prüft `pruefeSemester`.
  lehrjahr: z.number().int().nullish(),
  halbjahr: z.number().int().nullish(),
});

/**
 * Ändert ein Semester. Ob es das laufende ist, wird hier bewusst NICHT
 * angefasst — dafür gibt es `/api/semester/[id]/aktuell`. Sonst müsste jede
 * Bearbeitung den Zustand aller anderen Semester mitverantworten.
 *
 * Das Kürzel ist nach dem Anlegen fest (`pruefeKuerzelUnveraendert`): Es steht
 * in den Audit-Einträgen, im Blatt- und Dateinamen der Excel-Liste. Ein anderes
 * Kürzel im Rumpf wird feldgenau mit 400 abgewiesen.
 *
 * Ändert sich der Beginn, zieht dieselbe Transaktion die Frist der
 * Überleitungs-Links nach (`ziehLinkfristNach`) — sonst liefen sie nach einer
 * Verschiebung nach hinten am alten Datum ab. Ein Beginn heute oder früher, der
 * die Rückmeldung schlagartig schließen würde, wird bei offenen Einladungen mit
 * 409 abgewiesen: Der nächste stündliche Lauf meldete sonst alle Eingeladenen
 * ohne Antwort ungefragt als „keine Rückmeldung" ab.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const maengel = pruefeSemester(geprueft.data);
  if (maengel.length > 0) return fehler("Bitte prüfe die markierten Felder.", 400, maengel);

  const { id } = await kontext.params;
  const vorher = await prisma.semester.findUnique({ where: { id } });
  if (!vorher) return fehler("Dieses Semester gibt es nicht.", 404);

  const kuerzel = pruefeKuerzelUnveraendert(vorher.code, geprueft.data.code);
  if (kuerzel) return fehler("Bitte prüfe die markierten Felder.", 400, [kuerzel]);

  // Dieselbe Umformung wie beim Anlegen — siehe `lib/semester.ts`. Das Kürzel
  // wird unverändert zurückgeschrieben (auch in seiner gespeicherten
  // Schreibweise).
  const daten = { ...semesterDaten(geprueft.data), code: vorher.code };
  const startGeaendert = daten.start.getTime() !== vorher.start.getTime();

  if (startGeaendert) {
    const jetzt = new Date();
    if (!semesterHatBegonnen(vorher.start, jetzt) && semesterHatBegonnen(daten.start, jetzt)) {
      const offen = await zaehleOffeneEinladungen(id);
      if (offen > 0) {
        const meldung =
          `Für dieses Semester ${offen === 1 ? "steht noch 1 Rückmeldung" : `stehen noch ${offen} Rückmeldungen`} ` +
          "zur Semesterüberleitung aus. Mit diesem Beginn wäre die Rückmeldung sofort geschlossen, und wer noch nicht " +
          "geantwortet hat, würde als „keine Rückmeldung“ abgemeldet. Bitte einen späteren Beginn wählen oder die " +
          "offenen Rückmeldungen vorher klären.";
        // Oben nur kurz, die Einzelheit am Feld: Sonst stünde die lange Meldung
        // im Formular zweimal (Alert und Feldfehler) und würde zweimal vorgelesen.
        return fehler("Bitte prüfe den Semesterbeginn.", 409, [{ feld: "start", meldung }]);
      }
    }
  }

  try {
    const { semester, linksNachgezogen } = await prisma.$transaction(async (tx) => {
      const geaendert = await tx.semester.update({ where: { id }, data: daten });
      // Die Links gelten bis Semesterstart — mit dem Beginn wandert ihre Frist.
      const nachgezogen = startGeaendert ? await ziehLinkfristNach(tx, id, geaendert.start) : 0;
      return { semester: geaendert, linksNachgezogen: nachgezogen };
    });

    await protokolliere({
      aktion: "SEMESTER_GEAENDERT",
      objektTyp: "Semester",
      objektId: id,
      akteurId: benutzer.id,
      vorher: {
        code: vorher.code,
        bezeichnung: vorher.bezeichnung,
        start: vorher.start,
        ende: vorher.ende,
        lehrjahr: vorher.lehrjahr,
        halbjahr: vorher.halbjahr,
      },
      nachher: {
        code: semester.code,
        bezeichnung: semester.bezeichnung,
        start: semester.start,
        ende: semester.ende,
        lehrjahr: semester.lehrjahr,
        halbjahr: semester.halbjahr,
        ...(startGeaendert ? { linksNachgezogen } : {}),
      },
      headers: request.headers,
    });

    return erfolg({ gespeichert: true });
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      return fehler("Dieses Kürzel ist bereits vergeben.", 409);
    }
    throw ausnahme;
  }
}

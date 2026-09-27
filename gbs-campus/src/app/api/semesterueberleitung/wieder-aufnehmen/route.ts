import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";

const schema = z.object({ teilnahmeId: z.string().uuid() });

/**
 * Nimmt eine abgemeldete Teilnahme wieder auf (Schulleitung, Recht
 * SEMESTER_VERWALTEN): hebt „bin raus" bzw. „keine Rückmeldung" auf und
 * bestätigt die Teilnahme — ab dann steht die Person wieder in allen Listen
 * des Semesters.
 *
 * Nur hier lässt sich eine vom Worker gesetzte „keine Rückmeldung" aufheben: Ab
 * Semesterstart führt das Wiederauftauchen einer Person in den Listen der
 * Dozenten nicht mehr über ihren eigenen Link, sondern über eine bewusste
 * Entscheidung der Schulleitung.
 *
 * Atomar über ein bedingtes updateMany auf „noch abgemeldet": Ein Doppelklick
 * oder zwei Tabs ergeben einen Audit-Eintrag, keinen zweiten.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);
  const { teilnahmeId } = geprueft.data;

  const teilnahme = await prisma.teilnahme.findUnique({
    where: { id: teilnahmeId },
    select: {
      abgemeldetAm: true,
      abmeldeGrund: true,
      semester: { select: { code: true } },
      person: { select: { status: { select: { istAktiv: true, bezeichnung: true } } } },
    },
  });
  if (!teilnahme) return fehler("Diese Teilnahme gibt es nicht.", 404);
  if (!teilnahme.abgemeldetAm) return fehler("Diese Teilnahme ist nicht abgemeldet.", 409);
  // Wer nicht (mehr) aktiv ist, stünde nach dem Wiederaufnehmen trotzdem in
  // keiner Liste — das wäre ein Erfolg, der nichts bewirkt.
  if (!teilnahme.person.status.istAktiv) {
    return fehler(
      `Diese Person ist nicht aktiv (Status „${teilnahme.person.status.bezeichnung}“). Bitte zuerst den Status klären.`,
      409,
    );
  }

  const jetzt = new Date();
  const gesetzt = await prisma.teilnahme.updateMany({
    where: { id: teilnahmeId, abgemeldetAm: { not: null } },
    data: { abgemeldetAm: null, abmeldeGrund: null, bestaetigtAm: jetzt },
  });
  if (gesetzt.count !== 1) return fehler("Diese Teilnahme wurde gerade schon wieder aufgenommen.", 409);

  await protokolliere({
    aktion: "TEILNAHME_WIEDER_AUFGENOMMEN",
    objektTyp: "Teilnahme",
    objektId: teilnahmeId,
    akteurId: benutzer.id,
    vorher: { semester: teilnahme.semester.code, abgemeldetAm: teilnahme.abgemeldetAm, abmeldeGrund: teilnahme.abmeldeGrund },
    nachher: { bestaetigtAm: jetzt },
    headers: request.headers,
  });

  return erfolg({ wiederAufgenommen: true });
}

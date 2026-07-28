import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeSemester, semesterDaten } from "@/lib/semester";

const schema = z.object({
  code: z.string(),
  bezeichnung: z.string(),
  start: z.string(),
  ende: z.string(),
  anmeldungVon: z.string().nullish(),
  anmeldungBis: z.string().nullish(),
});

/**
 * Ändert ein Semester. Ob es das laufende ist, wird hier bewusst NICHT
 * angefasst — dafür gibt es `/api/semester/[id]/aktuell`. Sonst müsste jede
 * Bearbeitung den Zustand aller anderen Semester mitverantworten.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) return keineBerechtigung();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const maengel = pruefeSemester(geprueft.data);
  if (maengel.length > 0) return fehler("Bitte prüfe die markierten Felder.", 400, maengel);

  const { id } = await kontext.params;
  const vorher = await prisma.semester.findUnique({ where: { id } });
  if (!vorher) return fehler("Dieses Semester gibt es nicht.", 404);

  const eingabe = geprueft.data;
  try {
    // Dieselbe Umformung wie beim Anlegen — siehe `lib/semester.ts`.
    const semester = await prisma.semester.update({ where: { id }, data: semesterDaten(eingabe) });

    await protokolliere({
      aktion: "SEMESTER_GEAENDERT",
      objektTyp: "Semester",
      objektId: id,
      akteurId: benutzer.id,
      vorher: { code: vorher.code, bezeichnung: vorher.bezeichnung, start: vorher.start, ende: vorher.ende },
      nachher: { code: semester.code, bezeichnung: semester.bezeichnung, start: semester.start, ende: semester.ende },
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

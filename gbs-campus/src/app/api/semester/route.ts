import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { pruefeSemester, semesterDaten } from "@/lib/semester";

const schema = z.object({
  code: z.string(),
  bezeichnung: z.string(),
  start: z.string(),
  ende: z.string(),
  anmeldungVon: z.string().nullish(),
  anmeldungBis: z.string().nullish(),
  // Verortung im Kursraster, freiwillig. Zod prüft nur die Form (ganze Zahl oder
  // leer); Bereich und „beide oder keins" meldet `pruefeSemester` feldgenau.
  lehrjahr: z.number().int().nullish(),
  halbjahr: z.number().int().nullish(),
  istAktuell: z.boolean().optional(),
});

/**
 * Legt ein Semester an. Ohne ein Semester gibt es keine Teilnehmerliste und
 * keine Zuordnung eingehender Anmeldungen — deshalb ist das der erste Griff
 * vor jedem Jahrgang.
 */
export async function POST(request: NextRequest) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const maengel = pruefeSemester(geprueft.data);
  if (maengel.length > 0) return fehler("Bitte prüfen Sie die markierten Felder.", 400, maengel);

  const eingabe = geprueft.data;
  // Die Umformung steht in `lib/semester.ts` — dieselbe Funktion benutzt das
  // Ändern, damit beide Wege dasselbe aus einer Eingabe machen.
  const daten = semesterDaten(eingabe);

  try {
    const semester = await prisma.$transaction(async (tx) => {
      // Genau ein laufendes Semester — abgesichert durch einen partiellen
      // Unique-Index. Das Zurücksetzen muss deshalb VOR dem Setzen laufen und
      // in derselben Transaktion, sonst kollidiert das Anlegen mit dem
      // bisherigen laufenden Semester.
      if (eingabe.istAktuell) {
        await tx.semester.updateMany({ where: { istAktuell: true }, data: { istAktuell: false } });
      }
      return tx.semester.create({ data: { ...daten, istAktuell: eingabe.istAktuell ?? false } });
    });

    await protokolliere({
      aktion: "SEMESTER_ANGELEGT",
      objektTyp: "Semester",
      objektId: semester.id,
      akteurId: benutzer.id,
      nachher: {
        code: semester.code,
        bezeichnung: semester.bezeichnung,
        istAktuell: semester.istAktuell,
        lehrjahr: semester.lehrjahr,
        halbjahr: semester.halbjahr,
      },
      headers: request.headers,
    });

    return erfolg({ id: semester.id }, 201);
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      // Zwei Fälle laufen hier zusammen: doppeltes Kürzel (Unique auf `code`)
      // und ein zeitgleicher Versuch, ein laufendes Semester zu setzen
      // (partieller Index). Beide sind für den Bedienenden Wiederholungsfälle.
      const wegenCode = String(ausnahme.meta?.target ?? "").includes("code");
      return fehler(
        wegenCode
          ? "Dieses Kürzel ist bereits vergeben."
          : "Jemand hat zeitgleich ein anderes Semester als laufendes gesetzt. Bitte die Seite neu laden.",
        409,
      );
    }
    throw ausnahme;
  }
}

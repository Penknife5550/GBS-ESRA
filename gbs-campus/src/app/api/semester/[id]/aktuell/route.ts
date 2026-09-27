import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";

/**
 * Setzt dieses Semester als das laufende.
 *
 * Es gibt bewusst keinen Weg, das laufende Semester nur abzuschalten: Eine
 * Schule ohne laufendes Semester hätte eine leere Teilnehmerliste und
 * Anmeldungen ohne Zuordnung. Wer wechseln will, setzt das nächste — das
 * bisherige verliert die Markierung dabei automatisch.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const semester = await prisma.semester.findUnique({ where: { id } });
  if (!semester) return fehler("Dieses Semester gibt es nicht.", 404);
  if (semester.istAktuell) return erfolg({ gesetzt: true });

  const bisher = await prisma.semester.findFirst({ where: { istAktuell: true } });

  try {
    // Zurücksetzen und Setzen gehören in dieselbe Transaktion: Der partielle
    // Unique-Index lässt keine zwei laufenden Semester zu, und ein Abbruch
    // dazwischen ließe die Schule ohne laufendes Semester zurück.
    await prisma.$transaction(async (tx) => {
      await tx.semester.updateMany({ where: { istAktuell: true }, data: { istAktuell: false } });
      await tx.semester.update({ where: { id }, data: { istAktuell: true } });
    });
  } catch (ausnahme) {
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2002") {
      return fehler("Jemand hat zeitgleich ein anderes Semester gesetzt. Bitte die Seite neu laden.", 409);
    }
    throw ausnahme;
  }

  await protokolliere({
    aktion: "SEMESTER_LAUFEND_GESETZT",
    objektTyp: "Semester",
    objektId: id,
    akteurId: benutzer.id,
    vorher: { code: bisher?.code ?? null },
    nachher: { code: semester.code },
    headers: request.headers,
  });

  return erfolg({ gesetzt: true });
}

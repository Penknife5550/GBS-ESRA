import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { nochNichtImSemester } from "@/lib/teilnehmerliste";

/**
 * Übernimmt alle aktiven Personen, die diesem Semester noch nicht zugeordnet
 * sind.
 *
 * Warum es diesen Griff braucht: Eine Teilnahme entsteht sonst nur bei der
 * Aufnahme durch die Schulleitung. Wer aufgenommen wurde, BEVOR das Semester
 * angelegt war — und das ist beim ersten Jahrgang jeder —, stünde dauerhaft
 * nicht auf der Liste. Ein Klick statt einer Datenbanksitzung.
 *
 * Wer keine Teilnahmeform hinterlegt hat, wird ausgelassen und gezählt.
 * Geraten wird nichts: An der Teilnahmeform hängen Prüfungspflicht, Zeugnis
 * und künftig der Beitrag.
 *
 * Für dieses Semester Abgemeldete („bin raus", keine Rückmeldung) HABEN eine
 * Teilnahme und werden deshalb nicht neu angelegt (`nochNichtImSemester`) —
 * zurück kommen sie nur über „Wieder aufnehmen" auf der Überleitungsseite.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const semester = await prisma.semester.findUnique({ where: { id } });
  if (!semester) return fehler("Dieses Semester gibt es nicht.", 404);

  // Suchen und Anlegen gehören in EINE Transaktion. Vorher lagen zwei Schritte
  // dazwischen: Ein Doppelklick liess den zweiten Aufruf dieselben Personen
  // finden, `skipDuplicates` verwarf sie, und die Oberfläche meldete
  // „0 Personen übernommen" — obwohl gerade übernommen worden war. Innerhalb
  // der Transaktion sieht der zweite Aufruf sie gar nicht mehr.
  const { uebernommen, ohneTeilnahmeform } = await prisma.$transaction(async (tx) => {
    // Dieselbe Bedingung wie die Zählung auf der Teilnehmerseite — sonst zeigt
    // der Hinweis eine Zahl an, die der Knopf nicht einlöst.
    const offene = await tx.person.findMany({
      where: nochNichtImSemester(id),
      select: { id: true, teilnahmeform: true },
    });

    const uebernehmbar = offene.filter((person) => person.teilnahmeform !== null);

    // `skipDuplicates` bleibt als zweite Sicherung: Der Unique-Index
    // (personId, semesterId) darf die Übernahme nie mit einem 500 beenden.
    const angelegt = await tx.teilnahme.createMany({
      data: uebernehmbar.map((person) => ({
        personId: person.id,
        semesterId: id,
        teilnahmeform: person.teilnahmeform!,
      })),
      skipDuplicates: true,
    });

    return { uebernommen: angelegt.count, ohneTeilnahmeform: offene.length - uebernehmbar.length };
  });

  await protokolliere({
    aktion: "SEMESTER_TEILNEHMER_UEBERNOMMEN",
    objektTyp: "Semester",
    objektId: id,
    akteurId: benutzer.id,
    nachher: { code: semester.code, uebernommen, ohneTeilnahmeform },
    headers: request.headers,
  });

  return erfolg({ uebernommen, ohneTeilnahmeform });
}

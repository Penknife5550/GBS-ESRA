import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff, type AngemeldeteBenutzer } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, ROLLE } from "@/lib/constants";
import { ladeUebernahmeKandidat, teileNochNichtZugeordnete } from "@/lib/teilnehmerliste";

/** Ohne Rumpf (oder `{}`) die Sammelübernahme, mit `{ personId }` die Einzelübernahme. */
const schema = z.object({ personId: z.string().uuid().optional() });

type Semester = { id: string; code: string; start: Date };

/**
 * Übernimmt aktive Personen, die diesem Semester noch nicht zugeordnet sind —
 * alle auf einmal (ohne Rumpf) oder eine einzelne (`{ personId }`).
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
 *
 * „Zuletzt abgemeldet" (die jüngste Teilnahme VOR diesem Semester ist
 * abgemeldet) lässt die Sammelübernahme ebenfalls aus und zählt sie getrennt:
 * Sonst legte sie still wieder an, wer für das Vorsemester abgesagt hatte. Diese
 * Personen übernimmt die Schulleitung einzeln, mit `{ personId }`.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  // Der Rumpf ist freiwillig: Der Sammelknopf und ältere Aufrufer (Durchstich)
  // schicken keinen. Ein kaputter Rumpf ist aber ein Fehler, keine Sammelübernahme.
  const text = await request.text().catch(() => "");
  let eingabe: unknown = {};
  if (text.trim() !== "") {
    try {
      eingabe = JSON.parse(text);
    } catch {
      return fehler("Ungültige Anfrage.", 400);
    }
  }
  const geprueft = schema.safeParse(eingabe);
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const { id } = await kontext.params;
  const semester = await prisma.semester.findUnique({ where: { id }, select: { id: true, code: true, start: true } });
  if (!semester) return fehler("Dieses Semester gibt es nicht.", 404);

  if (geprueft.data.personId) {
    return uebernimmEinzeln(request, benutzer, semester, geprueft.data.personId);
  }

  // Suchen und Anlegen gehören in EINE Transaktion. Vorher lagen zwei Schritte
  // dazwischen: Ein Doppelklick liess den zweiten Aufruf dieselben Personen
  // finden, `skipDuplicates` verwarf sie, und die Oberfläche meldete
  // „0 Personen übernommen" — obwohl gerade übernommen worden war. Innerhalb
  // der Transaktion sieht der zweite Aufruf sie gar nicht mehr.
  const { uebernommen, ohneTeilnahmeform, zuletztAbgemeldet } = await prisma.$transaction(async (tx) => {
    // Dieselbe Abfrage wie die Zählung auf der Teilnehmerseite — sonst zeigt
    // der Hinweis eine Zahl an, die der Knopf nicht einlöst.
    const offen = await teileNochNichtZugeordnete(tx, semester);

    const mitForm = offen.uebernehmbar.flatMap((k) =>
      k.teilnahmeform ? [{ personId: k.personId, teilnahmeform: k.teilnahmeform }] : [],
    );

    // `skipDuplicates` bleibt als zweite Sicherung: Der Unique-Index
    // (personId, semesterId) darf die Übernahme nie mit einem 500 beenden.
    const angelegt = await tx.teilnahme.createMany({
      data: mitForm.map((k) => ({ personId: k.personId, semesterId: id, teilnahmeform: k.teilnahmeform })),
      skipDuplicates: true,
    });

    return {
      uebernommen: angelegt.count,
      ohneTeilnahmeform: offen.uebernehmbar.length - mitForm.length,
      zuletztAbgemeldet: offen.zuletztAbgemeldet.length,
    };
  });

  await protokolliere({
    aktion: "SEMESTER_TEILNEHMER_UEBERNOMMEN",
    objektTyp: "Semester",
    objektId: id,
    akteurId: benutzer.id,
    nachher: { code: semester.code, uebernommen, ohneTeilnahmeform, zuletztAbgemeldet },
    headers: request.headers,
  });

  return erfolg({ uebernommen, ohneTeilnahmeform, zuletztAbgemeldet });
}

/**
 * Übernimmt EINE Person — gedacht für die „zuletzt Abgemeldeten", die die
 * Sammelübernahme auslässt, gilt aber für jede Person, die `nochNichtImSemester`
 * erfüllt. Die Prüfung läuft in derselben Transaktion wie das Anlegen; erst wenn
 * sie scheitert, wird für die Meldung nachgesehen, warum.
 */
async function uebernimmEinzeln(
  request: NextRequest,
  benutzer: AngemeldeteBenutzer,
  semester: Semester,
  personId: string,
): Promise<Response> {
  const ergebnis = await prisma.$transaction(async (tx) => {
    const kandidat = await ladeUebernahmeKandidat(tx, semester, personId);
    if (!kandidat) return { status: "nicht_offen" as const };
    if (!kandidat.teilnahmeform) return { status: "ohne_form" as const };

    const angelegt = await tx.teilnahme.createManyAndReturn({
      data: [{ personId, semesterId: semester.id, teilnahmeform: kandidat.teilnahmeform }],
      skipDuplicates: true,
      select: { id: true },
    });
    if (angelegt.length !== 1) return { status: "gerade_uebernommen" as const };
    return { status: "ok" as const, teilnahmeId: angelegt[0].id, kandidat };
  });

  if (ergebnis.status === "nicht_offen") return warumNichtUebernehmbar(personId, semester.id);
  if (ergebnis.status === "ohne_form") {
    return fehler("Für diese Person ist keine Teilnahmeform hinterlegt. Bitte zuerst in der Akte nachtragen.", 409);
  }
  if (ergebnis.status === "gerade_uebernommen") return fehler("Diese Person wurde gerade schon übernommen.", 409);

  const { kandidat, teilnahmeId } = ergebnis;
  await protokolliere({
    aktion: "SEMESTER_TEILNEHMER_EINZELN_UEBERNOMMEN",
    objektTyp: "Teilnahme",
    objektId: teilnahmeId,
    akteurId: benutzer.id,
    // Nur Ids und Codes. War die Person zuletzt abgemeldet, steht hier, welche
    // Absage die Schulleitung bewusst übergangen hat.
    nachher: {
      semester: semester.code,
      personId,
      teilnahmeform: kandidat.teilnahmeform,
      zuletztAbgemeldet: kandidat.zuletztAbgemeldet
        ? { semester: kandidat.zuletztAbgemeldet.semesterCode, grund: kandidat.zuletztAbgemeldet.grund }
        : null,
    },
    headers: request.headers,
  });

  return erfolg({ uebernommen: 1, teilnahmeId });
}

/** Die Meldung, wenn eine Person `nochNichtImSemester` nicht erfüllt — nur zur Erklärung, entschieden ist schon. */
async function warumNichtUebernehmbar(personId: string, semesterId: string): Promise<Response> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      status: { select: { istAktiv: true, bezeichnung: true } },
      rollen: { select: { rolleCode: true } },
      teilnahmen: { where: { semesterId }, select: { abgemeldetAm: true } },
    },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);

  const teilnahme = person.teilnahmen[0];
  if (teilnahme?.abgemeldetAm) {
    return fehler(
      "Diese Person ist für dieses Semester abgemeldet. Zurück holen Sie sie über „Wieder aufnehmen“ auf der Seite Semesterüberleitung.",
      409,
    );
  }
  if (teilnahme) return fehler("Diese Person ist diesem Semester bereits zugeordnet.", 409);
  if (!person.status.istAktiv) {
    return fehler(
      `Diese Person ist nicht aktiv (Status „${person.status.bezeichnung}“). Bitte zuerst den Status klären.`,
      409,
    );
  }
  if (!person.rollen.some((r) => r.rolleCode === ROLLE.TEILNEHMER)) {
    return fehler("Diese Person ist kein Teilnehmer und lässt sich deshalb nicht übernehmen.", 409);
  }
  return fehler("Diese Person lässt sich diesem Semester nicht zuordnen. Bitte laden Sie die Seite neu.", 409);
}

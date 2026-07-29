import { NextRequest } from "next/server";
import { z } from "zod";
import { AnmeldungStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { willEhepartnerErmaessigung, ERMAESSIGUNG_EHEPARTNER } from "@/lib/beitrag";

const schema = z.discriminatedUnion("entscheidung", [
  z.object({ entscheidung: z.literal("ANNEHMEN") }),
  z.object({ entscheidung: z.literal("ABLEHNEN"), grund: z.string().min(1).max(2000) }),
]);

/**
 * Der Schulleiter entscheidet über eine Anmeldung.
 *
 * Bei Annahme wandert die Person von INTERESSENT auf ANGENOMMEN — ab dann greift
 * der Beitragslauf, deshalb wird der Wechsel protokolliert und nicht still
 * gesetzt. Bei Ablehnung bleibt sie INTERESSENT; ein eigener Terminalstatus
 * dafür wäre eine Behauptung über einen Menschen, die die Schule so nicht führt.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht("ANMELDUNG_ENTSCHEIDEN");
  if (!benutzer) {
    return keineBerechtigung();
  }

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Bei einer Ablehnung ist ein Grund erforderlich.", 400);
  }

  const { id } = await kontext.params;
  const anmeldung = await prisma.anmeldung.findUnique({ where: { id }, include: { person: true } });

  if (!anmeldung) return fehler("Diese Anmeldung gibt es nicht.", 404);
  if (!anmeldung.person) {
    return fehler("Zu dieser Anmeldung gibt es keine Akte.", 409);
  }
  if (anmeldung.status !== AnmeldungStatus.EINGEREICHT) {
    return fehler("Über diese Anmeldung ist bereits entschieden.", 409);
  }

  const person = anmeldung.person;
  const entscheidung = geprueft.data;
  const annehmen = entscheidung.entscheidung === "ANNEHMEN";

  // Die Statuspruefung oben und das Schreiben hier sind zwei Schritte. Ein
  // Doppelklick oder ein zweiter Tab erzeugte vorher ZWEI Statuswechsel und
  // ZWEI Willkommensmails an denselben Menschen. Deshalb wird die Bedingung in
  // die schreibende Anweisung gezogen: Nur wer den Datensatz noch im Zustand
  // EINGEREICHT antrifft, gewinnt.
  const ergebnis = await prisma.$transaction(async (tx) => {
    const geaendert = await tx.anmeldung.updateMany({
      where: { id, status: AnmeldungStatus.EINGEREICHT },
      data: {
        status: annehmen ? AnmeldungStatus.ANGENOMMEN : AnmeldungStatus.ABGELEHNT,
        entschiedenAm: new Date(),
        entschiedenVonId: benutzer.id,
        ablehnungsgrund: entscheidung.entscheidung === "ABLEHNEN" ? entscheidung.grund : null,
      },
    });
    if (geaendert.count !== 1) return null;

    if (!annehmen) return { semesterId: null, teilnahmeAngelegt: false, ermaessigungGesetzt: false };

    // Ehepartner-Ermäßigung: Wer sich laut Anmeldung gemeinsam mit dem
    // Ehepartner beworben hat, bekommt bei der Aufnahme die 50 %-Ermäßigung am
    // Konto vermerkt — die Grundlage für den Beitragslauf ab Release 0.3. Nur,
    // wenn noch keine andere Ermäßigung hinterlegt ist (eine per Hand gesetzte
    // Härtefall-Ermäßigung darf die Automatik nicht überschreiben).
    const setzeErmaessigung =
      !person.ermaessigungCode && willEhepartnerErmaessigung((anmeldung.antworten ?? {}) as Record<string, unknown>);

    await tx.person.update({
      where: { id: person.id },
      data: {
        statusCode: "ANGENOMMEN",
        ...(setzeErmaessigung ? { ermaessigungCode: ERMAESSIGUNG_EHEPARTNER } : {}),
      },
    });
    await tx.statusWechsel.create({
      data: {
        personId: person.id,
        vonCode: person.statusCode,
        nachCode: "ANGENOMMEN",
        grund: "Anmeldung angenommen",
        ausgeloestVonId: benutzer.id,
      },
    });

    // Wer aufgenommen wird, gehört auf die Teilnehmerliste. Zugeordnet wird das
    // Semester, für das die Anmeldung galt — und nur ersatzweise das laufende:
    // Wer sich im Juli für September angemeldet hat, soll nicht im gerade
    // laufenden Semester landen.
    //
    // Die Ersatzabfrage steht IN der Transaktion. Davor gelesen, hätte ein
    // zeitgleiches Umschalten des laufenden Semesters die frisch aufgenommene
    // Person im alten Semester abgelegt — und niemand hätte es bemerkt, weil
    // die Zuordnung stillschweigend gelingt.
    //
    // Beides kann fehlen: Ohne angelegtes Semester gibt es keine Zuordnung, und
    // ohne Teilnahmeform wird nicht geraten (daran hängen Prüfungspflicht,
    // Zeugnis und ab 0.3 der Beitrag). Der Aufrufer erfährt das ausdrücklich,
    // und die Teilnehmerliste weist zusätzlich auf Nichtzugeordnete hin.
    const semesterId =
      anmeldung.semesterId ??
      (await tx.semester.findFirst({ where: { istAktuell: true }, select: { id: true } }))?.id ??
      null;
    const teilnahmeform = anmeldung.teilnahmeform ?? person.teilnahmeform;

    if (semesterId && teilnahmeform) {
      // `createMany` mit `skipDuplicates` statt `create`: Eine bereits
      // bestehende Teilnahme — etwa durch die Sammelübernahme im
      // Semesterbereich — darf die Aufnahme nicht mit einem 500 abbrechen.
      await tx.teilnahme.createMany({
        data: [{ personId: person.id, semesterId, teilnahmeform }],
        skipDuplicates: true,
      });
    }

    return { semesterId, teilnahmeAngelegt: Boolean(semesterId && teilnahmeform), ermaessigungGesetzt: setzeErmaessigung };
  });

  if (!ergebnis) {
    return fehler("Über diese Anmeldung ist bereits entschieden.", 409);
  }

  // Ab hier ist die Transaktion committet: Die Entscheidung STEHT. Was jetzt
  // noch scheitert — Protokoll, Vorlage, Versand —, darf den Bedienenden nicht
  // mit einem 500 behelligen: Er hielte die Aufnahme für gescheitert, klickte
  // erneut und bekäme einen 409. Also laut loggen und Erfolg melden, wie es
  // `lib/anmeldung.ts` beim Eingang schon tut.
  //
  // `sendeMail` fängt SMTP-Fehler selbst ab, wirft aber bei Datenbankfehlern
  // weiter — dieser Block ist also kein Zierrat.
  let mailGesendet: boolean | null = null;

  try {
    await protokolliere({
      aktion: annehmen ? "ANMELDUNG_ANGENOMMEN" : "ANMELDUNG_ABGELEHNT",
      objektTyp: "Anmeldung",
      objektId: id,
      akteurId: benutzer.id,
      vorher: { status: anmeldung.status, personStatus: person.statusCode },
      nachher: {
        status: annehmen ? "ANGENOMMEN" : "ABGELEHNT",
        personStatus: annehmen ? "ANGENOMMEN" : person.statusCode,
        ...(annehmen
          ? {
              semesterId: ergebnis.semesterId,
              teilnahmeAngelegt: ergebnis.teilnahmeAngelegt,
              ermaessigung: ergebnis.ermaessigungGesetzt ? ERMAESSIGUNG_EHEPARTNER : (person.ermaessigungCode ?? null),
            }
          : {}),
      },
      headers: request.headers,
    });

    // Der Schulleiter bekommt zu sehen, ob die Bestaetigung wirklich rausging.
    // Vorher meldete die Route immer Erfolg, und er hielt jemanden fuer
    // informiert, bei dem nie etwas ankam.
    if (annehmen) {
      const vorlage = await prisma.emailVorlage.findUnique({ where: { code: "ANMELDUNG_ANGENOMMEN" } });
      const werte = {
        vorname: person.vorname,
        link: `${process.env.APP_URL ?? ""}/anmelden`,
      };
      const versand = await sendeMail({
        an: person.email,
        personId: person.id,
        vorlageCode: "ANMELDUNG_ANGENOMMEN",
        betreff: fuelleVorlage(vorlage?.betreff ?? "Willkommen an der Gemeindebibelschule Minden", werte),
        text: fuelleVorlage(vorlage?.textMd ?? "Hallo {{vorname}},\n\nwir freuen uns auf dich.", werte),
      });
      mailGesendet = versand.gesendet;
    }
    // Bei einer Ablehnung geht bewusst keine automatische Mail raus. Eine Absage
    // an einen Menschen, der sich für eine Bibelschule beworben hat, formuliert
    // der Schulleiter selbst — das war die ausdrückliche Linie im Interview.
  } catch (ausnahme) {
    console.error("[ANMELDUNG] Nachbereitung nach entschiedener Anmeldung fehlgeschlagen:", id, ausnahme);
    // `false` und nicht `null`: Die Oberfläche weist dann auf die nicht
    // zugestellte Bestätigung hin. Bei einer Ablehnung bleibt es `null` —
    // dort war ohnehin keine Mail vorgesehen.
    if (annehmen) mailGesendet = false;
  }

  return erfolg({
    entschieden: true,
    mailGesendet,
    // null bei einer Ablehnung — dort ist die Frage nach der Teilnahme nicht
    // gestellt worden.
    semesterZugeordnet: annehmen ? ergebnis.teilnahmeAngelegt : null,
    // Sichtbar für den Bediener: Eine gesetzte Ehepartner-Ermäßigung ist eine
    // finanzielle Änderung (halber Beitrag) und darf nicht unbemerkt passieren.
    ermaessigungGesetzt: annehmen ? ergebnis.ermaessigungGesetzt : null,
  });
}

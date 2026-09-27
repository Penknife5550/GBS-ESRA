import { NextRequest } from "next/server";
import { z } from "zod";
import { AnmeldungStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import { erfolg, fehler } from "@/lib/api";
import { willEhepartnerErmaessigung, ERMAESSIGUNG_EHEPARTNER } from "@/lib/beitrag";
import { EINRICHTUNG, MAIL_VORLAGE, RECHT, STATUS } from "@/lib/constants";
import { SYSTEM_GRUND } from "@/lib/status";
import { wechsleStatus } from "@/lib/status-io";

const schema = z.discriminatedUnion("entscheidung", [
  z.object({ entscheidung: z.literal("ANNEHMEN") }),
  z.object({ entscheidung: z.literal("ABLEHNEN"), grund: z.string().min(1).max(2000) }),
]);

/** Abbruchsignal: Der Personenstatus wurde zwischen Lesen und Schreiben geändert (rollt zurück). */
class PersonStatusGeaendert extends Error {}

/**
 * Der Schulleiter entscheidet über eine Anmeldung.
 *
 * Bei Annahme wandert die Person von INTERESSENT auf ANGENOMMEN — ab dann greift
 * der Beitragslauf, deshalb wird der Wechsel protokolliert und nicht still
 * gesetzt. Bei Ablehnung bleibt sie INTERESSENT; ein eigener Terminalstatus
 * dafür wäre eine Behauptung über einen Menschen, die die Schule so nicht führt.
 *
 * Der Personenstatus wird bedingt geschrieben (`wechsleStatus`): Steht die
 * Person inzwischen in einem Endzustand oder wurde sie anonymisiert, gibt es
 * 409 statt einer „Wiederaufnahme" am Endzustand vorbei (Code-Review 4, M7).
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.ANMELDUNG_ENTSCHEIDEN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) {
    return fehler("Bei einer Ablehnung ist ein Grund erforderlich.", 400);
  }

  const { id } = await kontext.params;
  const anmeldung = await prisma.anmeldung.findUnique({ where: { id }, include: { person: { include: { status: true } } } });

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

  // Eine anonymisierte Person hat keine offene Anmeldung mehr (die
  // Anonymisierung schließt sie) — und ein neuer Freitext-Ablehnungsgrund wäre
  // wieder Personenbezug, den keine Anonymisierung mehr erfasst.
  if (person.statusCode === STATUS.ANONYMISIERT) {
    return fehler("Diese Person ist anonymisiert — über ihre Anmeldung wird nicht mehr entschieden.", 409);
  }
  // Aus einem Endzustand führt die Aufnahme nicht heraus. Ablehnen bleibt
  // möglich: Es schließt nur die Anmeldung und ändert den Status nicht.
  if (annehmen && person.status.istTerminal) {
    return fehler(
      `Die Person steht auf „${person.status.bezeichnung}" (Endzustand) — eine Aufnahme ist nicht mehr möglich.`,
      409,
    );
  }

  // Die Statuspruefung oben und das Schreiben hier sind zwei Schritte. Ein
  // Doppelklick oder ein zweiter Tab erzeugte vorher ZWEI Statuswechsel und
  // ZWEI Willkommensmails an denselben Menschen. Deshalb wird die Bedingung in
  // die schreibende Anweisung gezogen: Nur wer den Datensatz noch im Zustand
  // EINGEREICHT antrifft, gewinnt.
  let ergebnis: { semesterId: string | null; teilnahmeAngelegt: boolean; ermaessigungGesetzt: boolean } | null;
  try {
    ergebnis = await prisma.$transaction(async (tx) => {
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
      // Konto vermerkt — die Grundlage für den künftigen Beitragslauf. Nur,
      // wenn noch keine andere Ermäßigung hinterlegt ist (eine per Hand gesetzte
      // Härtefall-Ermäßigung darf die Automatik nicht überschreiben).
      const setzeErmaessigung =
        !person.ermaessigungCode && willEhepartnerErmaessigung((anmeldung.antworten ?? {}) as Record<string, unknown>);

      // Bedingt auf den gelesenen Status: Wurde die Person inzwischen
      // anonymisiert oder anders gesetzt, rollt die ganze Entscheidung zurück.
      const wechsel = await wechsleStatus({
        tx,
        personId: person.id,
        vonCode: person.statusCode,
        nachCode: STATUS.ANGENOMMEN,
        grund: SYSTEM_GRUND.ANMELDUNG_ANGENOMMEN,
        akteurId: benutzer.id,
      });
      if (!wechsel.ok) throw new PersonStatusGeaendert();
      if (setzeErmaessigung) {
        await tx.person.update({ where: { id: person.id }, data: { ermaessigungCode: ERMAESSIGUNG_EHEPARTNER } });
      }

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
      // Zeugnis und künftig der Beitrag). Der Aufrufer erfährt das ausdrücklich,
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
  } catch (ausnahme) {
    if (ausnahme instanceof PersonStatusGeaendert) {
      return fehler("Der Status dieser Person wurde gerade geändert. Bitte die Seite neu laden.", 409);
    }
    // P2034: Schreibkonflikt oder Deadlock mit einem zeitgleichen Vorgang an
    // derselben Person (etwa einer Anonymisierung) — Postgres hat diese Seite
    // abgebrochen, nichts ist geschrieben. Ein Konflikt, kein Serverfehler.
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2034") {
      return fehler("Diese Anmeldung wurde gerade gleichzeitig bearbeitet. Bitte die Seite neu laden.", 409);
    }
    throw ausnahme;
  }

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
        status: annehmen ? AnmeldungStatus.ANGENOMMEN : AnmeldungStatus.ABGELEHNT,
        personStatus: annehmen ? STATUS.ANGENOMMEN : person.statusCode,
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
      const vorlage = await prisma.emailVorlage.findUnique({ where: { code: MAIL_VORLAGE.ANMELDUNG_ANGENOMMEN } });
      const werte = {
        vorname: person.vorname,
        link: `${process.env.APP_URL ?? ""}/anmelden`,
      };
      const versand = await sendeMail({
        an: person.email,
        personId: person.id,
        vorlageCode: MAIL_VORLAGE.ANMELDUNG_ANGENOMMEN,
        betreff: fuelleVorlage(vorlage?.betreff ?? `Willkommen an der ${EINRICHTUNG.name}`, werte),
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

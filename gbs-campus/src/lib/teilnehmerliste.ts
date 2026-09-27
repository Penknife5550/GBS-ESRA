/**
 * GBS Campus — Teilnehmerliste eines Semesters
 *
 * Eine Abfrage für zwei Wege: die Ansicht in der Verwaltung und die
 * Excel-Datei. Getrennte Abfragen wären zwei Wahrheiten — und die Excel-Liste
 * ist genau das, was diese Software ablösen soll.
 *
 * Dasselbe gilt für die Frage, wer der Liste noch fehlt: Zählung und Übernahme
 * teilen `teileNochNichtZugeordnete` (siehe `nochNichtImSemester`).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROLLE } from "@/lib/constants";
import type { ExportZeile } from "@/lib/semester";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { zuletztAbgemeldet } from "@/lib/ueberleitung-regel";

export type TeilnehmerZeile = ExportZeile & { personId: string };

/**
 * Alle Personen, die diesem Semester zugeordnet sind UND deren Status als
 * aktiv gilt. Der Statusschalter `istAktiv` ist die führende Quelle: Wer
 * abgebrochen hat, behält seine Teilnahme als Historie, steht aber nicht mehr
 * auf der Liste. Ebenso fehlt, wessen Teilnahme für dieses Semester abgemeldet
 * ist („bin raus" oder keine Rückmeldung zur Überleitung, `TEILNAHME_ZAEHLT`).
 *
 * Die Teilnahmeform kommt aus der Teilnahme, nicht aus der Person — sie darf
 * sich zwischen Semestern ändern (vom Hörer zum Schüler und zurück).
 */
export async function ladeTeilnehmer(semesterId: string): Promise<TeilnehmerZeile[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { semesterId, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
    select: {
      teilnahmeform: true,
      person: {
        select: {
          id: true,
          vorname: true,
          nachname: true,
          email: true,
          telefon: true,
          strasse: true,
          plz: true,
          ort: true,
          geburtsdatum: true,
          gemeinde: true,
          status: { select: { bezeichnung: true } },
          ermaessigung: { select: { bezeichnung: true } },
        },
      },
    },
    orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
  });

  return teilnahmen.map((teilnahme) => ({
    personId: teilnahme.person.id,
    nachname: teilnahme.person.nachname,
    vorname: teilnahme.person.vorname,
    email: teilnahme.person.email,
    telefon: teilnahme.person.telefon,
    strasse: teilnahme.person.strasse,
    plz: teilnahme.person.plz,
    ort: teilnahme.person.ort,
    geburtsdatum: teilnahme.person.geburtsdatum,
    gemeinde: teilnahme.person.gemeinde,
    teilnahmeform: teilnahme.teilnahmeform,
    status: teilnahme.person.status.bezeichnung,
    ermaessigung: teilnahme.person.ermaessigung?.bezeichnung ?? null,
  }));
}

/**
 * Wie viele aktive Personen für dieses Semester abgemeldet sind — sie fehlen
 * bewusst in der Liste, und die Seite sagt das, statt sie lautlos wegzulassen.
 */
export async function zaehleAbgemeldete(semesterId: string): Promise<number> {
  return prisma.teilnahme.count({
    where: { semesterId, abgemeldetAm: { not: null }, person: PERSON_ZAEHLT_AKTIV },
  });
}

/**
 * Die gemeinsame Bedingung von Zählung und Übernahme — eine Wahrheit. Sie gilt
 * nie allein: Zählung (Teilnehmerseite) und Sammelübernahme (Route
 * `POST /api/semester/[id]/teilnehmer`) gehen beide durch
 * `teileNochNichtZugeordnete`, das darauf noch die Regel „zuletzt abgemeldet"
 * legt; die Einzelübernahme derselben Route durch `ladeUebernahmeKandidat` mit
 * derselben Bedingung. So löst der Knopf genau die Zahl ein, die die Seite zeigt.
 *
 * Bewusst `none` über ALLE Teilnahmen des Semesters, auch abgemeldete: Wer
 * „bin raus" gesagt hat oder ohne Rückmeldung herausgefallen ist, HAT eine
 * Teilnahme und gilt deshalb nicht als „noch nicht zugeordnet". Sonst legte die
 * Sammelübernahme ihn stillschweigend wieder an — zurück kommt er nur über
 * „Wieder aufnehmen" auf der Überleitungsseite.
 *
 * Gezählt werden nur Personen mit der Rolle Teilnehmer. Sonst stünde auch die
 * Schulleitung in der Zahl: Mitarbeiter sind dieselbe Entität mit anderen
 * Rollen und tragen ebenfalls einen Status — der Hinweis würde eine Lücke
 * melden, die keine ist.
 */
export function nochNichtImSemester(semesterId: string) {
  return {
    ...PERSON_ZAEHLT_AKTIV,
    rollen: { some: { rolleCode: ROLLE.TEILNEHMER } },
    teilnahmen: { none: { semesterId } },
  };
}

/** Was Zählung und Übernahme über eine Person wissen müssen — samt ihrer
 * Teilnahmen in anderen Semestern für die Regel „zuletzt abgemeldet". */
const KANDIDAT_FELDER = {
  id: true,
  vorname: true,
  nachname: true,
  teilnahmeform: true,
  teilnahmen: {
    select: {
      abgemeldetAm: true,
      abmeldeGrund: true,
      semester: { select: { code: true, bezeichnung: true, start: true } },
    },
  },
} satisfies Prisma.PersonSelect;

export type UebernahmeKandidat = {
  personId: string;
  /** „Nachname, Vorname" — nur für die Anzeige. */
  name: string;
  teilnahmeform: "SCHUELER" | "HOERER" | null;
  /** Gesetzt, wenn die jüngste Teilnahme VOR diesem Semester abgemeldet ist. */
  zuletztAbgemeldet: { semesterCode: string; semester: string; grund: string | null } | null;
};

function alsKandidat(
  person: Prisma.PersonGetPayload<{ select: typeof KANDIDAT_FELDER }>,
  zielStart: Date,
): UebernahmeKandidat {
  const juengste = zuletztAbgemeldet(
    person.teilnahmen.map((t) => ({
      semesterStart: t.semester.start,
      abgemeldetAm: t.abgemeldetAm,
      grund: t.abmeldeGrund,
      semesterCode: t.semester.code,
      semester: t.semester.bezeichnung,
    })),
    zielStart,
  );
  return {
    personId: person.id,
    name: `${person.nachname}, ${person.vorname}`,
    teilnahmeform: person.teilnahmeform,
    zuletztAbgemeldet: juengste
      ? { semesterCode: juengste.semesterCode, semester: juengste.semester, grund: juengste.grund }
      : null,
  };
}

/**
 * Die diesem Semester noch nicht Zugeordneten (`nochNichtImSemester`), geteilt
 * in zwei Gruppen:
 *
 *  - `uebernehmbar`: Diese übernimmt die Sammelübernahme (sofern eine
 *    Teilnahmeform hinterlegt ist), und diese Zahl zeigt der Hinweis auf der
 *    Teilnehmerseite.
 *  - `zuletztAbgemeldet`: Ihre jüngste Teilnahme vor diesem Semester ist
 *    abgemeldet („Ich bin raus" oder keine Rückmeldung, Regel
 *    `zuletztAbgemeldet`). Die Sammelübernahme lässt sie aus — sonst wirkte eine
 *    Absage nur ein Semester lang. Die Seite nennt sie getrennt, zum einzelnen
 *    Übernehmen.
 *
 * `db` ist der Prisma-Client oder die Transaktion der Übernahme — Zählung und
 * Knopf teilen so dieselbe Abfrage.
 */
export async function teileNochNichtZugeordnete(
  db: Prisma.TransactionClient,
  semester: { id: string; start: Date },
): Promise<{ uebernehmbar: UebernahmeKandidat[]; zuletztAbgemeldet: UebernahmeKandidat[] }> {
  const personen = await db.person.findMany({
    where: nochNichtImSemester(semester.id),
    select: KANDIDAT_FELDER,
    orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
  });
  const kandidaten = personen.map((person) => alsKandidat(person, semester.start));
  return {
    uebernehmbar: kandidaten.filter((k) => k.zuletztAbgemeldet === null),
    zuletztAbgemeldet: kandidaten.filter((k) => k.zuletztAbgemeldet !== null),
  };
}

/**
 * Eine einzelne Person für die Einzelübernahme — unter derselben Bedingung
 * `nochNichtImSemester` und mit derselben Regel „zuletzt abgemeldet" wie
 * `teileNochNichtZugeordnete`. Null, wenn die Person die Bedingung nicht erfüllt
 * (unbekannt, nicht aktiv, keine Teilnehmerrolle oder schon zugeordnet).
 */
export async function ladeUebernahmeKandidat(
  db: Prisma.TransactionClient,
  semester: { id: string; start: Date },
  personId: string,
): Promise<UebernahmeKandidat | null> {
  const person = await db.person.findFirst({
    where: { id: personId, ...nochNichtImSemester(semester.id) },
    select: KANDIDAT_FELDER,
  });
  return person ? alsKandidat(person, semester.start) : null;
}

/**
 * GBS Campus — Teilnehmerliste eines Semesters
 *
 * Eine Abfrage für zwei Wege: die Ansicht in der Verwaltung und die
 * Excel-Datei. Getrennte Abfragen wären zwei Wahrheiten — und die Excel-Liste
 * ist genau das, was diese Software ablösen soll.
 */

import { prisma } from "@/lib/db";
import { ROLLE } from "@/lib/constants";
import type { ExportZeile } from "@/lib/semester";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";

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
 * Wie viele aktive Personen diesem Semester noch NICHT zugeordnet sind.
 *
 * Diese Zahl ist der Grund, warum es den Übernehmen-Knopf gibt: Eine Teilnahme
 * entsteht sonst nur bei der Aufnahme. Wer aufgenommen wurde, bevor das
 * Semester angelegt war, fehlte sonst stillschweigend auf der Liste — und
 * niemand hätte gemerkt, dass die Liste unvollständig ist.
 *
 * Gezählt werden nur Personen mit der Rolle Teilnehmer. Sonst stünde auch die
 * Schulleitung in dieser Zahl: Mitarbeiter sind dieselbe Entität mit anderen
 * Rollen und tragen ebenfalls einen Status — der Hinweis würde eine Lücke
 * melden, die keine ist.
 */
export async function zaehleOhneTeilnahme(semesterId: string): Promise<number> {
  return prisma.person.count({ where: nochNichtImSemester(semesterId) });
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
 * Die gemeinsame Bedingung von Zählung und Sammelübernahme — eine Wahrheit.
 *
 * Bewusst `none` über ALLE Teilnahmen des Semesters, auch abgemeldete: Wer
 * „bin raus" gesagt hat oder ohne Rückmeldung herausgefallen ist, HAT eine
 * Teilnahme und gilt deshalb nicht als „noch nicht zugeordnet". Sonst legte die
 * Sammelübernahme ihn stillschweigend wieder an — zurück kommt er nur über
 * „Wieder aufnehmen" auf der Überleitungsseite.
 */
export function nochNichtImSemester(semesterId: string) {
  return {
    ...PERSON_ZAEHLT_AKTIV,
    rollen: { some: { rolleCode: ROLLE.TEILNEHMER } },
    teilnahmen: { none: { semesterId } },
  };
}

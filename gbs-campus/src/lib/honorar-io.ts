/**
 * GBS Campus — Dozentenhonorar: Datenbank-Operationen
 *
 * Der IO-Teil zu `honorar.ts` (dort die DB-freie Rechnung): die Dozenten für die
 * Zuordnung im Stundenplan und die read-only Honorar-Übersicht je Semester
 * (Anzahl gehaltener Abende × Satz). Die Abrechnung selbst folgt in Release 0.3.
 */

import { prisma } from "@/lib/db";
import { zahl } from "@/lib/einstellungen";
import { ROLLE } from "@/lib/constants";
import { honorarBetrag } from "@/lib/honorar";

export type DozentAuswahl = { id: string; name: string };

/**
 * Die Personen mit der Rolle Dozent — Grundlage der Zuordnung im Stundenplan.
 * Nur wer diese Rolle trägt, lässt sich einem Abend als Dozent zuordnen; die
 * Zuordnungsroute prüft das noch einmal serverseitig.
 */
export async function ladeDozenten(): Promise<DozentAuswahl[]> {
  const personen = await prisma.person.findMany({
    where: { rollen: { some: { rolleCode: ROLLE.DOZENT } } },
    select: { id: true, vorname: true, nachname: true },
    orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
  });
  return personen.map((p) => ({ id: p.id, name: `${p.nachname}, ${p.vorname}` }));
}

/** Ob eine Person als Dozent zugeordnet werden darf (trägt die Rolle Dozent). */
export async function istDozent(personId: string): Promise<boolean> {
  const treffer = await prisma.personRolle.findUnique({
    where: { personId_rolleCode: { personId, rolleCode: ROLLE.DOZENT } },
    select: { personId: true },
  });
  return treffer !== null;
}

export type HonorarZeile = { dozentId: string; name: string; abende: number; betrag: number };
export type HonorarUebersicht = { satz: number; zeilen: HonorarZeile[]; summe: number };

/**
 * Honorar-Übersicht eines Semesters: je Dozent die Anzahl der von ihm
 * bereits gehaltenen Unterrichtsabende × Honorarsatz. Zusammengezählt wird über
 * `groupBy` auf `dozentId`; die Namen werden anschließend nachgeladen.
 *
 * „Gehalten" heißt: der Abend hat begonnen (`beginn <= jetzt`) — dieselbe Grenze
 * wie bei der Selbstbestätigung. Ein Semester wird üblicherweise als ganzes
 * Dienstags-Raster im Voraus angelegt; künftige, einem Dozenten schon
 * zugeordnete Abende dürfen deshalb nicht als bereits geleistetes Honorar
 * erscheinen. Sie zählen erst mit, sobald sie stattgefunden haben.
 */
export async function ladeHonorarUebersicht(semesterId: string): Promise<HonorarUebersicht> {
  const satz = await zahl("HONORAR_SATZ_PRO_ABEND");

  const gruppen = await prisma.unterrichtstermin.groupBy({
    by: ["dozentId"],
    where: { semesterId, dozentId: { not: null }, beginn: { lte: new Date() } },
    _count: { _all: true },
  });
  if (gruppen.length === 0) return { satz, zeilen: [], summe: 0 };

  const ids = gruppen.map((g) => g.dozentId).filter((id): id is string => id !== null);
  const personen = await prisma.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, vorname: true, nachname: true },
  });
  const nameById = new Map(personen.map((p) => [p.id, `${p.nachname}, ${p.vorname}`]));

  const zeilen: HonorarZeile[] = gruppen
    .filter((g): g is typeof g & { dozentId: string } => g.dozentId !== null)
    .map((g) => ({
      dozentId: g.dozentId,
      name: nameById.get(g.dozentId) ?? "—",
      abende: g._count._all,
      betrag: honorarBetrag(g._count._all, satz),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const summe = zeilen.reduce((s, z) => s + z.betrag, 0);
  return { satz, zeilen, summe };
}

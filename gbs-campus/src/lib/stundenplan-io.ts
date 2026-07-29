/**
 * GBS Campus — Stundenplan & Anwesenheit: Datenbank-Operationen
 *
 * Der IO-Teil zu `stundenplan.ts` (dort die DB-freie Kernlogik): die
 * Dienstagabende eines Semesters anlegen, die Anwesenheit erfassen und die
 * Quoten-Übersicht laden.
 */

import { Anwesenheitsstatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { zahl } from "@/lib/einstellungen";
import { anwesenheitsquote, dienstagstermine } from "@/lib/stundenplan";

export type GenerierErgebnis = { fehler: "semester_fehlt" } | { angelegt: number; uebersprungen: number };

/**
 * Legt die `anzahl` Dienstagabende eines Semesters an (ab dem Semesterbeginn,
 * wöchentlich). Idempotent: bereits vorhandene Abende (gleicher Zeitpunkt) werden
 * übersprungen — ein zweiter Aufruf legt nichts doppelt an und rührt bestehende
 * Anwesenheiten nicht an.
 */
export async function generiereDienstagstermine(
  semesterId: string,
  anzahl: number,
  akteurId: string,
  headers: Headers,
): Promise<GenerierErgebnis> {
  const semester = await prisma.semester.findUnique({
    where: { id: semesterId },
    select: { id: true, code: true, start: true },
  });
  if (!semester) return { fehler: "semester_fehlt" };

  const gewuenscht = dienstagstermine(semester.start, anzahl);
  const vorhanden = new Set(
    (await prisma.unterrichtstermin.findMany({ where: { semesterId }, select: { beginn: true } })).map((t) =>
      t.beginn.getTime(),
    ),
  );
  const neu = gewuenscht.filter((d) => !vorhanden.has(d.getTime()));

  if (neu.length > 0) {
    const bisher = vorhanden.size;
    await prisma.unterrichtstermin.createMany({
      data: neu.map((beginn, i) => ({ semesterId, beginn, reihenfolge: bisher + i })),
    });
  }

  await protokolliere({
    aktion: "STUNDENPLAN_TERMINE_GENERIERT",
    objektTyp: "Semester",
    objektId: semesterId,
    akteurId,
    nachher: { code: semester.code, angelegt: neu.length },
    headers,
  });

  return { angelegt: neu.length, uebersprungen: gewuenscht.length - neu.length };
}

export type AnwesenheitEintrag = { teilnahmeId: string; status: Anwesenheitsstatus };
export type ErfassErgebnis = { fehler: "termin_fehlt" } | { gesetzt: number };

/**
 * Erfasst die Anwesenheit für einen Termin, mehrere Teilnehmer auf einmal.
 * Upsert je (Termin, Teilnahme) — idempotent und ohne Doppelzeilen. Nur
 * Teilnahmen desselben Semesters werden angenommen (kein Eintrag für eine
 * fremde Teilnahme).
 */
export async function erfasseAnwesenheit(
  terminId: string,
  eintraege: AnwesenheitEintrag[],
  akteurId: string,
  headers: Headers,
): Promise<ErfassErgebnis> {
  const termin = await prisma.unterrichtstermin.findUnique({
    where: { id: terminId },
    select: { id: true, semesterId: true },
  });
  if (!termin) return { fehler: "termin_fehlt" };

  const gueltig = new Set(
    (await prisma.teilnahme.findMany({ where: { semesterId: termin.semesterId }, select: { id: true } })).map(
      (t) => t.id,
    ),
  );

  let gesetzt = 0;
  for (const eintrag of eintraege) {
    if (!gueltig.has(eintrag.teilnahmeId)) continue;
    await prisma.anwesenheit.upsert({
      where: { terminId_teilnahmeId: { terminId, teilnahmeId: eintrag.teilnahmeId } },
      update: { status: eintrag.status, erfasstVonId: akteurId },
      create: { terminId, teilnahmeId: eintrag.teilnahmeId, status: eintrag.status, erfasstVonId: akteurId },
    });
    gesetzt++;
  }

  await protokolliere({
    aktion: "ANWESENHEIT_ERFASST",
    objektTyp: "Unterrichtstermin",
    objektId: terminId,
    akteurId,
    nachher: { gesetzt },
    headers,
  });

  return { gesetzt };
}

/**
 * Quoten-Übersicht eines Semesters: je aktivem Teilnehmer die Anwesenheitsquote
 * über die erfassten Termine. Die Schwelle kommt aus der Einstellung.
 */
export async function ladeAnwesenheitsUebersicht(semesterId: string) {
  const schwelle = await zahl("ANWESENHEIT_MINDEST_PROZENT");
  const gesamtTermine = await prisma.unterrichtstermin.count({ where: { semesterId } });

  const teilnahmen = await prisma.teilnahme.findMany({
    where: { semesterId, person: { status: { istAktiv: true } } },
    select: {
      id: true,
      person: { select: { vorname: true, nachname: true } },
      anwesenheiten: { select: { status: true } },
    },
    orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
  });

  return {
    schwelle,
    gesamtTermine,
    zeilen: teilnahmen.map((t) => ({
      teilnahmeId: t.id,
      name: `${t.person.nachname}, ${t.person.vorname}`,
      quote: anwesenheitsquote(
        t.anwesenheiten.map((a) => a.status),
        schwelle,
      ),
    })),
  };
}

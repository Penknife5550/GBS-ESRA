/**
 * GBS Campus — Daten für „Meine Daten“ (Übersicht und Abende des Teilnehmers)
 *
 * Ergänzt `ladeEigeneUnterrichtstermine` (lib/stundenplan-io.ts) um das, was die
 * Seiten seit dem Oberflächenplan 09/2026 zusätzlich zeigen: auch die kommenden
 * Abende, Uhrzeit bis Ende, Fach und Thema. Status, „darf selbst bestätigen“ und
 * die Quote (Modell A) kommen unverändert aus dem geprüften Lader.
 */

import { prisma } from "@/lib/db";
import { ladeEigeneUnterrichtstermine } from "@/lib/stundenplan-io";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import type { QuoteModellA } from "@/lib/stundenplan";

export type MeinAbend = {
  id: string;
  beginn: Date;
  ende: Date | null;
  fach: string | null;
  thema: string | null;
  istVergangen: boolean;
  /** Eigener Status an einem gehaltenen Abend; null = noch kein Eintrag. */
  status: string | null;
  /** Darf die Person diesen Abend selbst bestätigen oder ändern? Nein, sobald die Schule erfasst hat. */
  darfBestaetigen: boolean;
};

export type MeinSemester = {
  teilnahmeId: string;
  bezeichnung: string;
  istAktuell: boolean;
  teilnahmeform: string;
  /** Die eigene Quote über alle Abende des Semesters; null, solange noch keiner gehalten ist. */
  quote: QuoteModellA | null;
  /** Alle Abende des Semesters, gehaltene und kommende, nach Beginn. */
  abende: MeinAbend[];
};

/** Die zählenden Teilnahmen der Person (neuestes Semester zuerst) mit allen Abenden. */
export async function ladeMeineSemester(personId: string, jetzt: Date): Promise<MeinSemester[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { personId, ...TEILNAHME_ZAEHLT },
    orderBy: { semester: { start: "desc" } },
    select: {
      id: true,
      semesterId: true,
      teilnahmeform: true,
      semester: { select: { bezeichnung: true, istAktuell: true } },
    },
  });
  if (teilnahmen.length === 0) return [];

  const [gruppen, termine] = await Promise.all([
    ladeEigeneUnterrichtstermine(personId, jetzt),
    prisma.unterrichtstermin.findMany({
      where: { semesterId: { in: teilnahmen.map((t) => t.semesterId) } },
      orderBy: { beginn: "asc" },
      select: {
        id: true,
        semesterId: true,
        beginn: true,
        ende: true,
        thema: true,
        kurseinheit: { select: { fach: { select: { bezeichnung: true } } } },
      },
    }),
  ]);
  const eigene = new Map(gruppen.flatMap((g) => g.termine.map((t) => [t.id, t] as const)));
  const quoteVon = new Map(gruppen.map((g) => [g.teilnahmeId, g.quote]));

  return teilnahmen.map((t) => ({
    teilnahmeId: t.id,
    bezeichnung: t.semester.bezeichnung,
    istAktuell: t.semester.istAktuell,
    teilnahmeform: t.teilnahmeform,
    quote: quoteVon.get(t.id) ?? null,
    abende: termine
      .filter((termin) => termin.semesterId === t.semesterId)
      .map((termin) => {
        const eintrag = eigene.get(termin.id);
        const istVergangen = terminVergangen(termin.beginn, jetzt);
        return {
          id: termin.id,
          beginn: termin.beginn,
          ende: termin.ende,
          fach: termin.kurseinheit?.fach.bezeichnung ?? null,
          thema: termin.thema?.trim() || null,
          istVergangen,
          status: eintrag?.status ?? null,
          // Fehlt der Abend im geprüften Lader (etwa gerade erst angelegt), wird
          // er nicht zur Bestätigung angeboten.
          darfBestaetigen: istVergangen && (eintrag?.darfBestaetigen ?? false),
        };
      }),
  }));
}

/** Das Semester, um das es gerade geht: das laufende, sonst das mit dem nächsten Abend, sonst das neueste. */
export function aktuellesSemester(semester: MeinSemester[]): MeinSemester | null {
  return (
    semester.find((s) => s.istAktuell) ??
    semester.find((s) => s.abende.some((a) => !a.istVergangen)) ??
    semester[0] ??
    null
  );
}

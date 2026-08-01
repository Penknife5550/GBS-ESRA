/**
 * GBS Campus — Leistungen & Noten: Datenbank-Operationen
 *
 * Der IO-Teil zu `leistung.ts` (dort die DB-freie Kernlogik): die
 * Kurseinheiten eines Dozenten bzw. eines Semesters mit ihren Teilnehmern und
 * bereits erfassten Bewertungen laden, die Noten erfassen (Dozent an der Quelle,
 * fach-scoped; Schulleitung für alle Fächer) und die eigenen Noten des Schülers.
 *
 * Modell-Anker: eine Leistung hängt an (Teilnahme × Kurseinheit). Welche
 * Kurseinheiten in einem Semester unterrichtet werden, ergibt sich aus
 * `Unterrichtstermin` (semesterId + kurseinheitId) — die Dozent→Fach-Zuordnung
 * ist implizit über die Termine. Achse ist die Kurseinheit, nicht der Termin;
 * deshalb wird auf (semesterId, kurseinheitId) dedupliziert.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { ergebnisName, pruefeLeistung, type LeistungNormal } from "@/lib/leistung";

// -----------------------------------------------------------------------------
// Ladeansichten (Matrix je Kurseinheit)
// -----------------------------------------------------------------------------

export type LeistungWert = { ergebnis: string; punkte: number | null; note: string | null };
export type NotenTeilnehmer = { teilnahmeId: string; name: string };

export type NotenKurseinheit = {
  kurseinheitId: string;
  fach: string;
  titel: string;
  /** Aktive Teilnehmer des Semesters — die Zeilen der Erfassungs-Matrix. */
  teilnehmer: NotenTeilnehmer[];
  /** teilnahmeId → bereits gespeicherte Bewertung. */
  leistungen: Record<string, LeistungWert>;
};

export type NotenSemesterGruppe = {
  semesterId: string;
  semesterBezeichnung: string;
  kurseinheiten: NotenKurseinheit[];
};

type KursZeile = {
  semesterId: string;
  semesterBezeichnung: string;
  kurseinheitId: string;
  fach: string;
  titel: string;
};

/**
 * Baut die nach Semester gruppierte Matrix aus einer (evtl. redundanten) Liste
 * von Kurseinheit-Zeilen (ein Eintrag je Termin). Dedupliziert auf
 * (semesterId, kurseinheitId), lädt die aktiven Teilnehmer der Semester und die
 * bereits erfassten Leistungen und ordnet beide der jeweiligen Kurseinheit zu.
 *
 * Wichtig: Dieselbe Kurseinheit (Fach×Rasterplatz) kann in mehreren
 * Kalendersemestern laufen — die Leistungen werden je Semester nur den
 * Teilnahmen DIESES Semesters zugeordnet (eine Teilnahme gehört zu genau einem
 * Semester), sonst zeigte ein Semester fremde Noten.
 */
async function baueNotenGruppen(zeilen: KursZeile[]): Promise<NotenSemesterGruppe[]> {
  if (zeilen.length === 0) return [];

  // Dedup (semesterId, kurseinheitId) unter Beibehaltung der Reihenfolge.
  const gesehen = new Set<string>();
  const dedupe: KursZeile[] = [];
  for (const z of zeilen) {
    const schluessel = `${z.semesterId}::${z.kurseinheitId}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    dedupe.push(z);
  }

  const semesterIds = [...new Set(dedupe.map((z) => z.semesterId))];
  const kurseinheitIds = [...new Set(dedupe.map((z) => z.kurseinheitId))];

  const [teilnahmen, leistungen] = await Promise.all([
    prisma.teilnahme.findMany({
      where: { semesterId: { in: semesterIds }, person: { status: { istAktiv: true } } },
      orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
      select: { id: true, semesterId: true, person: { select: { vorname: true, nachname: true } } },
    }),
    // Nur die Leistungen der betroffenen Semester laden. Dieselbe Kurseinheit
    // (Fach×Rasterplatz) kann über die Jahre in vielen Kalendersemestern laufen —
    // ohne den Semester-Filter holte die Query alle je erfassten Alt-Kohorten und
    // verwürfe sie erst in-memory. Der Filter ist semantisch identisch zur
    // teilnahmeIds-Prüfung unten, zieht die Einschränkung aber in die DB.
    prisma.leistung.findMany({
      where: { kurseinheitId: { in: kurseinheitIds }, teilnahme: { semesterId: { in: semesterIds } } },
      select: { teilnahmeId: true, kurseinheitId: true, ergebnis: true, punkte: true, note: true },
    }),
  ]);

  const teilnehmerProSemester = new Map<string, NotenTeilnehmer[]>();
  for (const t of teilnahmen) {
    const liste = teilnehmerProSemester.get(t.semesterId) ?? [];
    liste.push({ teilnahmeId: t.id, name: `${t.person.nachname}, ${t.person.vorname}` });
    teilnehmerProSemester.set(t.semesterId, liste);
  }

  // kurseinheitId → teilnahmeId → Wert.
  const leistungMap = new Map<string, Map<string, LeistungWert>>();
  for (const l of leistungen) {
    const proKurs = leistungMap.get(l.kurseinheitId) ?? new Map<string, LeistungWert>();
    proKurs.set(l.teilnahmeId, { ergebnis: l.ergebnis, punkte: l.punkte, note: l.note });
    leistungMap.set(l.kurseinheitId, proKurs);
  }

  return semesterIds.map((sid) => {
    const semZeilen = dedupe.filter((z) => z.semesterId === sid);
    const teilnehmer = teilnehmerProSemester.get(sid) ?? [];
    const teilnahmeIds = new Set(teilnehmer.map((t) => t.teilnahmeId));
    return {
      semesterId: sid,
      semesterBezeichnung: semZeilen[0].semesterBezeichnung,
      kurseinheiten: semZeilen.map((z) => {
        const proKurs = leistungMap.get(z.kurseinheitId);
        const leistungenRecord: Record<string, LeistungWert> = {};
        if (proKurs) {
          for (const [tid, wert] of proKurs) {
            if (teilnahmeIds.has(tid)) leistungenRecord[tid] = wert;
          }
        }
        return { kurseinheitId: z.kurseinheitId, fach: z.fach, titel: z.titel, teilnehmer, leistungen: leistungenRecord };
      }),
    };
  });
}

const KURS_SELECT = {
  semesterId: true,
  semester: { select: { bezeichnung: true } },
  kurseinheitId: true,
  kurseinheit: { select: { titel: true, fach: { select: { bezeichnung: true } } } },
} as const;

type TerminKursRoh = {
  semesterId: string;
  semester: { bezeichnung: string };
  kurseinheitId: string | null;
  kurseinheit: { titel: string; fach: { bezeichnung: string } } | null;
};

function zuKursZeilen(termine: TerminKursRoh[]): KursZeile[] {
  return termine
    .filter((t): t is TerminKursRoh & { kurseinheitId: string; kurseinheit: NonNullable<TerminKursRoh["kurseinheit"]> } =>
      Boolean(t.kurseinheitId && t.kurseinheit),
    )
    .map((t) => ({
      semesterId: t.semesterId,
      semesterBezeichnung: t.semester.bezeichnung,
      kurseinheitId: t.kurseinheitId,
      fach: t.kurseinheit.fach.bezeichnung,
      titel: t.kurseinheit.titel,
    }));
}

/**
 * Die Kurseinheiten, die die Person als Dozent unterrichtet (`dozentId` an einem
 * ihrer Termine, Kurseinheit zugeordnet), gruppiert nach Semester (neuestes
 * zuerst) — mit aktiven Teilnehmern und bereits erfassten Noten. Streng auf
 * `dozentId` gescoped; Termine ohne Kurseinheit fallen weg (ohne Fach nichts zu
 * benoten).
 */
export async function ladeEigeneDozentKurseinheiten(dozentId: string): Promise<NotenSemesterGruppe[]> {
  const termine = await prisma.unterrichtstermin.findMany({
    where: { dozentId, kurseinheitId: { not: null } },
    orderBy: [{ semester: { start: "desc" } }, { beginn: "asc" }],
    select: KURS_SELECT,
  });
  return baueNotenGruppen(zuKursZeilen(termine));
}

/**
 * Die Kurseinheiten EINES Semesters (Schulleitungssicht, alle Fächer) mit
 * aktiven Teilnehmern und bereits erfassten Noten. Termine ohne Kurseinheit
 * fallen weg.
 */
export async function ladeNotenUebersicht(semesterId: string): Promise<NotenKurseinheit[]> {
  const termine = await prisma.unterrichtstermin.findMany({
    where: { semesterId, kurseinheitId: { not: null } },
    orderBy: { beginn: "asc" },
    select: KURS_SELECT,
  });
  const gruppen = await baueNotenGruppen(zuKursZeilen(termine));
  return gruppen[0]?.kurseinheiten ?? [];
}

// -----------------------------------------------------------------------------
// Personen-Detailakte: Noten EINER Person in einem Semester
// -----------------------------------------------------------------------------

export type PersonNotenKurs = {
  kurseinheitId: string;
  fach: string;
  titel: string;
  /** Die bereits gespeicherte Bewertung dieser Person oder null (noch offen). */
  wert: LeistungWert | null;
};

export type PersonNoten = {
  teilnahmeId: string;
  semesterId: string;
  semesterBezeichnung: string;
  kurseinheiten: PersonNotenKurs[];
};

/**
 * Die Kurseinheiten des Semesters mit der Bewertung GENAU DIESER Person — für die
 * Inline-Noteneingabe auf der Detailakte. Baut auf `ladeNotenUebersicht`
 * (Schulleitungssicht) auf und projiziert daraus nur die Teilnahme der Person; das
 * Erfassungs-Payload ist identisch zur Matrix (`/api/noten`). `null`, wenn die
 * Person in diesem Semester keine Teilnahme hat (dann gibt es nichts zu benoten).
 */
export async function ladePersonNoten(personId: string, semesterId: string): Promise<PersonNoten | null> {
  const teilnahme = await prisma.teilnahme.findUnique({
    where: { personId_semesterId: { personId, semesterId } },
    select: { id: true, semester: { select: { bezeichnung: true } } },
  });
  if (!teilnahme) return null;

  // Nur die Kurseinheiten DIESES Semesters + die Leistungen DIESER einen Teilnahme
  // laden — nicht die ganze Semester-Kohorte (das täte `ladeNotenUebersicht`).
  const [termine, leistungen] = await Promise.all([
    prisma.unterrichtstermin.findMany({
      where: { semesterId, kurseinheitId: { not: null } },
      orderBy: { beginn: "asc" },
      select: KURS_SELECT,
    }),
    prisma.leistung.findMany({
      where: { teilnahmeId: teilnahme.id },
      select: { kurseinheitId: true, ergebnis: true, punkte: true, note: true },
    }),
  ]);

  const wertProKurs = new Map<string, LeistungWert>(
    leistungen.map((l) => [l.kurseinheitId, { ergebnis: l.ergebnis, punkte: l.punkte, note: l.note }]),
  );

  // Dedup: ein Termin je Abend → dieselbe Kurseinheit taucht mehrfach auf.
  const gesehen = new Set<string>();
  const kurseinheiten: PersonNotenKurs[] = [];
  for (const z of zuKursZeilen(termine)) {
    if (gesehen.has(z.kurseinheitId)) continue;
    gesehen.add(z.kurseinheitId);
    kurseinheiten.push({ kurseinheitId: z.kurseinheitId, fach: z.fach, titel: z.titel, wert: wertProKurs.get(z.kurseinheitId) ?? null });
  }

  return { teilnahmeId: teilnahme.id, semesterId, semesterBezeichnung: teilnahme.semester.bezeichnung, kurseinheiten };
}

// -----------------------------------------------------------------------------
// Erfassung
// -----------------------------------------------------------------------------

export type LeistungEintrag = { teilnahmeId: string; ergebnis: string; punkte?: number | null; note?: string | null };

/** Prüft/normalisiert alle Eintraege DB-frei; null, sobald einer ungültig ist. */
function normalisiereEintraege(eintraege: LeistungEintrag[]): (LeistungNormal & { teilnahmeId: string })[] | null {
  const ergebnis: (LeistungNormal & { teilnahmeId: string })[] = [];
  for (const e of eintraege) {
    const geprueft = pruefeLeistung({ ergebnis: e.ergebnis, punkte: e.punkte, note: e.note });
    if ("fehler" in geprueft) return null;
    ergebnis.push({ teilnahmeId: e.teilnahmeId, ...geprueft.wert });
  }
  return ergebnis;
}

/**
 * Schreibt die Noten mehrerer Teilnehmer zu EINER Kurseinheit — der gemeinsame
 * Kern von `erfasseNoteAlsDozent` und `erfasseNote`. Nur Teilnahmen desselben
 * Semesters werden angenommen (Whitelist vor der Transaktion); fremde werden
 * still übersprungen. Alle Upserts laufen in EINER Transaktion
 * (alles-oder-nichts): verschwindet die Kurseinheit oder eine Teilnahme in der
 * Lücke, meldet der Fremdschlüssel P2003/P2025 — das kommt als
 * `{ fehler: "kontext_fehlt" }` zurück (der Aufrufer antwortet 404) statt als 500.
 */
async function schreibeLeistungen(
  kurseinheitId: string,
  semesterId: string,
  eintraege: (LeistungNormal & { teilnahmeId: string })[],
  erfasstVonId: string,
): Promise<{ gesetzt: number } | { fehler: "kontext_fehlt" }> {
  const gueltig = new Set(
    (await prisma.teilnahme.findMany({ where: { semesterId }, select: { id: true } })).map((t) => t.id),
  );

  try {
    const gesetzt = await prisma.$transaction(
      async (tx) => {
        let n = 0;
        for (const e of eintraege) {
          if (!gueltig.has(e.teilnahmeId)) continue;
          await tx.leistung.upsert({
            where: { teilnahmeId_kurseinheitId: { teilnahmeId: e.teilnahmeId, kurseinheitId } },
            update: { ergebnis: e.ergebnis, punkte: e.punkte, note: e.note, erfasstVonId },
            create: { teilnahmeId: e.teilnahmeId, kurseinheitId, ergebnis: e.ergebnis, punkte: e.punkte, note: e.note, erfasstVonId },
          });
          n++;
        }
        return n;
      },
      // Wie bei der Anwesenheit: großzügiges Limit statt des 5-s-Defaults.
      { timeout: 15_000 },
    );
    return { gesetzt };
  } catch (ausnahme) {
    if (
      ausnahme instanceof Prisma.PrismaClientKnownRequestError &&
      (ausnahme.code === "P2003" || ausnahme.code === "P2025")
    ) {
      return { fehler: "kontext_fehlt" };
    }
    throw ausnahme;
  }
}

export type NotenErfassErgebnis = { fehler: "kontext_fehlt" | "fremd" | "ungueltig" } | { gesetzt: number };

/**
 * Der Dozent erfasst Noten für EINE seiner eigenen Kurseinheiten in einem
 * Semester, mehrere Teilnehmer auf einmal. Der eigentliche Schutz ist der
 * **Scope-Guard**: es muss ein eigener Termin (`dozentId`) zu genau dieser
 * Kurseinheit UND diesem Semester existieren — sonst `fremd` (die Route
 * antwortet 403). Das Recht öffnet nur die Tür. Mehrere Dozenten je Kurseinheit
 * sind möglich; wer mindestens einen Abend hält, darf erfassen.
 */
export async function erfasseNoteAlsDozent(
  dozentId: string,
  kurseinheitId: string,
  semesterId: string,
  eintraege: LeistungEintrag[],
  headers: Headers,
): Promise<NotenErfassErgebnis> {
  const eigenerAbend = await prisma.unterrichtstermin.findFirst({
    where: { dozentId, kurseinheitId, semesterId },
    select: { id: true },
  });
  if (!eigenerAbend) return { fehler: "fremd" };

  const normal = normalisiereEintraege(eintraege);
  if (!normal) return { fehler: "ungueltig" };

  const ergebnis = await schreibeLeistungen(kurseinheitId, semesterId, normal, dozentId);
  if ("fehler" in ergebnis) return ergebnis;

  await protokolliere({
    aktion: "LEISTUNG_ERFASST",
    objektTyp: "Kurseinheit",
    objektId: kurseinheitId,
    akteurId: dozentId,
    nachher: { gesetzt: ergebnis.gesetzt, semesterId, quelle: "DOZENT" },
    headers,
  });

  return ergebnis;
}

export type NotenVerwaltenErgebnis = { fehler: "kontext_fehlt" | "ungueltig" } | { gesetzt: number };

/**
 * Die Schulleitung erfasst Noten für EINE Kurseinheit in einem Semester, alle
 * Fächer (Recht NOTEN_VERWALTEN). Kein `fremd` — geprüft wird nur, dass die
 * Kurseinheit in diesem Semester überhaupt unterrichtet wird (sonst
 * `kontext_fehlt`).
 */
export async function erfasseNote(
  kurseinheitId: string,
  semesterId: string,
  eintraege: LeistungEintrag[],
  akteurId: string,
  headers: Headers,
): Promise<NotenVerwaltenErgebnis> {
  const abend = await prisma.unterrichtstermin.findFirst({
    where: { kurseinheitId, semesterId },
    select: { id: true },
  });
  if (!abend) return { fehler: "kontext_fehlt" };

  const normal = normalisiereEintraege(eintraege);
  if (!normal) return { fehler: "ungueltig" };

  const ergebnis = await schreibeLeistungen(kurseinheitId, semesterId, normal, akteurId);
  if ("fehler" in ergebnis) return ergebnis;

  await protokolliere({
    aktion: "LEISTUNG_ERFASST",
    objektTyp: "Kurseinheit",
    objektId: kurseinheitId,
    akteurId,
    nachher: { gesetzt: ergebnis.gesetzt, semesterId, quelle: "SCHULLEITUNG" },
    headers,
  });

  return ergebnis;
}

// -----------------------------------------------------------------------------
// Schüler-Selbstansicht
// -----------------------------------------------------------------------------

export type EigeneLeistung = {
  fach: string;
  titel: string;
  ergebnis: string;
  ergebnisText: string;
  punkte: number | null;
  note: string | null;
};

export type EigeneLeistungGruppe = { semesterBezeichnung: string; leistungen: EigeneLeistung[] };

/**
 * Die eigenen Noten des Schülers, gruppiert nach Semester (neuestes zuerst).
 * Rein lesend (Recht PERSON_LESEN_EIGENE). Semester ohne Noten fallen weg.
 */
export async function ladeEigeneLeistungen(personId: string): Promise<EigeneLeistungGruppe[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { personId },
    orderBy: { semester: { start: "desc" } },
    select: {
      semester: { select: { bezeichnung: true } },
      leistungen: {
        select: {
          ergebnis: true,
          punkte: true,
          note: true,
          kurseinheit: {
            select: { titel: true, sortierung: true, fach: { select: { bezeichnung: true } } },
          },
        },
      },
    },
  });

  return teilnahmen
    .map((t) => ({
      semesterBezeichnung: t.semester.bezeichnung,
      leistungen: t.leistungen
        .slice()
        .sort(
          (a, b) =>
            a.kurseinheit.sortierung - b.kurseinheit.sortierung ||
            a.kurseinheit.fach.bezeichnung.localeCompare(b.kurseinheit.fach.bezeichnung),
        )
        .map((l) => ({
          fach: l.kurseinheit.fach.bezeichnung,
          titel: l.kurseinheit.titel,
          ergebnis: l.ergebnis,
          ergebnisText: ergebnisName(l.ergebnis),
          punkte: l.punkte,
          note: l.note,
        })),
    }))
    .filter((g) => g.leistungen.length > 0);
}
